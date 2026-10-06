'use strict'
const mineflayer = require('mineflayer')
const { pathfinder, goals } = require('mineflayer-pathfinder')
const readline = require('node:readline')
const droppedItem = require('./dropped-item')

const options = require('./read-options')(process.argv.slice(2))
const output = value => process.stdout.write(JSON.stringify(value) + '\n')
console.log = (...args) => console.error(...args)
const bot = mineflayer.createBot(options)
bot.loadPlugin(pathfinder)
bot.loadPlugin(require('./safe-step'))
let pathWrapped = false
let ready = false
let observer = null
let skills = null
let paused = false
const controls = []
const blocked = new Map()
const limited = require('./with-timeout')(bot)
const key = p => `${p.x},${p.y},${p.z}`
const isWood = name => /(_log|_stem)$/.test(name || '')
if(process.env.MINE_DEBUG_ROUTE==='1'){
  let reported=0
  bot.on('path_update',result=>{
    if(Date.now()-reported<10000)return
    reported=Date.now()
    const p=bot.entity.position.floored()
    const cells=[]
    for(let y=0;y<3;y++)for(const [x,z] of [[0,0],[-1,0],[0,-1],[-1,-1]]){
      const b=bot.blockAt(p.offset(x,y,z));cells.push({position:b?.position,name:b?.name,shapes:b?.shapes})
    }
    console.error('ROUTE',JSON.stringify({status:result.status,position:bot.entity.position,held:bot.heldItem?.name,controls:bot.controlState,next:result.path.slice(0,2),cells}))
  })
}

bot.on('error', error => console.error(error.message))
bot.on('kicked', reason => console.error('Minecraft:', JSON.stringify(reason)))
bot.on('end', () => { ready = false; process.exitCode = 1; process.exit(1) })
bot.on('death', () => {
  ready = false
  console.error('Бот погиб. Перезапустите запись/запуск в безопасном учебном мире.')
})
bot.on('spawn', async () => {
  ready = false
  if (!pathWrapped) {
    const pathGoto = bot.pathfinder.goto.bind(bot.pathfinder)
    bot.pathfinder.goto = async goal => {
      if(!goal.isEnd(bot.entity.position.floored()))await limited(require('./center-position')(bot),3000)
      await pathGoto(goal)
      const position = bot.entity.position.floored()
      if (!goal.isEnd(position) && !goal.isEnd(position.offset(0,1,0))) throw new Error('Путь не найден или цель не достигнута.')
    }
    pathWrapped = true
  }
  const movements = require('./navigation')(bot)
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 6000
  bot.pathfinder.tickTimeout = 20
  try {
    await bot.waitForChunksToLoad()
    if (!skills) skills = require('./skills')(bot, limited, blocked, options)
    if (options.viewer && !observer) observer = await require('./observer')(bot, () => ({...skills.snapshot(),paused}), options.viewerPort || 3007, skills.radar, request => {
      if(request.command==='pause')paused=Boolean(request.enabled)
      else if(controls.length<5)controls.push(request)
    })
    ready = true
    console.error(`Бот ${bot.username} вошёл в Minecraft ${bot.version}.`)
  } catch (error) { console.error(error.message) }
})

function targets () {
  const log = bot.findBlock({
    matching: block => block !== null && isWood(block.name),
    useExtraInfo: block =>
      block.position.y <= bot.entity.position.y + 3 &&
      !skills.protectedBase(block.position) &&
      (blocked.get(key(block.position)) || 0) < Date.now(),
    maxDistance: 24
  })
  const drop = bot.nearestEntity(entity => {
    if (entity.name !== 'item') return false
    const item = droppedItem(entity)
    return item && isWood(item.name) &&
      entity.position.distanceTo(bot.entity.position) < 8 &&
      (blocked.get(`item:${entity.id}`) || 0) < Date.now()
  })
  return { log, drop }
}

function observe (consumeControls = false) {
  if (!ready || !bot.entity || bot.health <= 0) throw new Error('Бот пока не готов или погиб.')
  const { log, drop } = targets()
  const pos = bot.entity.position
  return {
    log: log ? { distance: pos.distanceTo(log.position),
      can_chop: bot.canDigBlock(log) && bot.canSeeBlock(log) } : null,
    drop: drop ? { distance: pos.distanceTo(drop.position) } : null,
    health: bot.health, food: bot.food,
    wood: bot.inventory.items().filter(item => isWood(item.name))
      .reduce((total, item) => total + item.count, 0),
    inventory: Object.fromEntries(skills.items().map(item => [item.name, skills.count(item.name)])),
    emptySlots:bot.inventory.emptySlotCount(),
    table: Boolean(skills.table()), viewer: observer?.url || null,
    armor: skills.armor(),
    tools: bot.inventory.items().filter(item=>item.maxDurability).map(item=>({name:item.name,remaining:item.maxDurability-(item.durabilityUsed||0),enchants:item.enchants||[]})),
    level: bot.experience.level,
    inLava: Boolean(bot.entity.isInLava),
    threats: Object.values(bot.entities).filter(entity=>entity.position&&['creeper','piglin_brute','wither_skeleton','blaze','ghast','zombie','skeleton'].includes(entity.name)&&entity.position.distanceTo(pos)<8).map(entity=>({name:entity.name,distance:entity.position.distanceTo(pos)})),
    windowType: bot.currentWindow?.type || 'inventory', controls: consumeControls?controls.splice(0):[], players: skills.radar.playerList(), target: skills.radar.getTarget(),
    paused, stashes: skills.ui.stashes, stage: skills.ui.stage,
    home:skills.ui.home,portals:skills.ui.portals,portalOverrides:skills.ui.portalOverrides,portalPlan:skills.ui.portalPlan,qwenPlanner:skills.ui.qwenPlanner,
    miningTrail:skills.ui.miningTrail,
    obsidianFactory:skills.ui.obsidianFactory,
    pendingLoot:skills.ui.pendingLoot,
    mineResume:skills.ui.mineResume,miningPolicy:skills.ui.miningPolicy,miningMetrics:skills.ui.miningMetrics,
    looseItems:Object.values(bot.entities).filter(e=>e.name==='item'&&e.position.distanceTo(pos)<48).map(e=>({id:e.id,name:droppedItem(e)?.name,count:droppedItem(e)?.count,position:e.position})),
    position: { x: pos.x, y: pos.y, z: pos.z }, version: bot.version, dimension: bot.game.dimension
  }
}

async function action (name) {
  observe()
  const { log, drop } = targets()
  try {
    if (name === 'explore') {
      const p = bot.entity.position
      const angle = Math.random() * Math.PI * 2
      await limited(bot.pathfinder.goto(new goals.GoalXZ(
        Math.floor(p.x + Math.cos(angle) * 10), Math.floor(p.z + Math.sin(angle) * 10))), 12000)
    } else if (name === 'approach') {
      if (!log) throw new Error('В пределах обзора нет дерева.')
      await limited(bot.pathfinder.goto(new goals.GoalLookAtBlock(
        log.position, bot.world, { reach: 4 })), 12000)
      await bot.lookAt(log.position.offset(.5, .5, .5))
      const current = bot.blockAt(log.position)
      if (!current || !isWood(current.name) || !bot.canDigBlock(current) || !bot.canSeeBlock(current)) {
        throw new Error('Подошли, но до бревна всё ещё нельзя дотянуться.')
      }
    } else if (name === 'chop') {
      if (!log || !bot.canDigBlock(log) || !bot.canSeeBlock(log)) {
        throw new Error('До бревна нельзя дотянуться.')
      }
      try { await limited(bot.dig(log), 15000) } finally { bot.stopDigging() }
      await bot.waitForTicks(10)
    } else if (name === 'pickup') {
      if (!drop) throw new Error('Рядом нет выпавшего бревна.')
      const p = drop.position
      await limited(bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 0)), 12000)
      await bot.waitForTicks(15)
    } else {
      throw new Error(`Неизвестное действие: ${name}`)
    }
    return { ok: true, state: observe() }
  } catch (error) {
    if (name === 'approach' && log) blocked.set(key(log.position), Date.now() + 60000)
    if (name === 'pickup' && drop) blocked.set(`item:${drop.id}`, Date.now() + 30000)
    return { ok: false, error: error.message, state: ready ? observe() : null }
  }
}

async function handle (request) {
  if(request.command==='control_state')return {paused}
  if(request.command==='pause'){paused=Boolean(request.enabled);return {paused}}
  if (request.command === 'state') return observe(!request.peek)
  if (request.command === 'act') return action(request.action)
  if(!ready || !bot.entity || bot.health<=0)throw new Error('Бот пока не готов или погиб.')
  return skills.handle(request)
}

setInterval(()=>{if(ready){try{output({checkpoint:observe()})}catch(error){}}},5000).unref()

const input = readline.createInterface({ input: process.stdin })
let pending = Promise.resolve()
input.on('line', line => {
  pending = pending.then(async () => {
    let request
    try {
      request = JSON.parse(line)
      const result = await handle(request)
      output({ id: request.id, result })
    } catch (error) {
      output({ id: request?.id, error: request?.command==='state'?error.message:`${request?.command}: ${error.message}` })
    }
  })
})
input.on('close', () => {
  observer?.close()
  bot.pathfinder?.setGoal(null)
  bot.clearControlStates()
  bot.quit()
  setTimeout(() => process.exit(0), 500).unref()
})
