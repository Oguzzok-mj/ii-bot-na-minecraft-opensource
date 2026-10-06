'use strict'
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const droppedItem = require('./dropped-item')

module.exports = (bot, limited, blocked, options = {}) => {
  const clickWindow = bot.clickWindow.bind(bot)
  bot.clickWindow = async (...args) => {
    const window = bot.currentWindow || bot.inventory
    await clickWindow(...args)
    await bot.waitForTicks(2)
    if (bot.supportFeature('stateIdUsed')) await limited(bot._syncWindow(window), 3000)
  }
  let tablePosition = null
  let direction = null
  let depth = 0
  const route = []
  const radar = require('./radar')(bot)
  const ui = { stage: 'Готов к работе', inventoryOpen: false, crafting: null, home: options.home || {x:0,y:64,z:0}, portals:options.portals||{},portalPlan:options.portalPlan||null,miningTrail:options.miningTrail||{},pendingLoot:options.pendingLoot||null }
  ui.portalOverrides=options.portalOverrides||{}
  if(options.obsidianFactory&&['overworld','minecraft:overworld'].includes(options.obsidianFactory.dimension))ui.obsidianFactory=options.obsidianFactory
  const armor = () => Object.fromEntries(['head','torso','legs','feet'].map((name,index)=>[name,bot.inventory.slots[5+index]?.name || null]))
  ui.mineResume=options.mineResume||null
  const key = p => `${p.x},${p.y},${p.z}`
  const items = () => (bot.currentWindow || bot.inventory).items()
  const count = name => items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0)
  const serialize = item => item ? { name: item.name, label: item.displayName, count: item.count, remaining: item.maxDurability ? item.maxDurability-(item.durabilityUsed||0) : null, enchants: item.enchants || [] } : null
  const hazardous = block => !block || /water|lava|sand$|gravel|powder_snow/.test(block.name)
  const protectedBase = p => {
    const home=ui.home
    return home&&['overworld','minecraft:overworld'].includes(bot.game?.dimension||'overworld')&&p.y>=home.y-4&&Math.hypot(p.x-home.x,p.z-home.z)<12
  }
  const solid = block => block && block.boundingBox === 'block' && !hazardous(block)
  const stone = block => block && ['stone', 'cobblestone', 'deepslate'].includes(block.name)
  bot.canSeeBlock = block => {
    if (!block || !bot.entity) return false
    const eye = bot.entity.position.offset(0,bot.entity.eyeHeight || 1.62,0)
    return [[.5,.999,.5],[.5,.001,.5],[.001,.5,.5],[.999,.5,.5],[.5,.5,.001],[.5,.5,.999]].some(face=>{
      const point=block.position.offset(...face), distance=eye.distanceTo(point)
      if(distance>4.8)return false
      return bot.world.raycast(eye,point.minus(eye).normalize(),distance+.02)?.position.equals(block.position) || false
    })
  }
  const table = () => {
    const known = tablePosition && bot.blockAt(tablePosition)
    if (known?.name === 'crafting_table'&&known.position.distanceTo(bot.entity.position)<8) return known
    const found = bot.findBlock({ matching: block => block?.name === 'crafting_table', maxDistance: 32 })
    if (found) {tablePosition = found.position.clone();return found}
    return known?.name==='crafting_table'?known:null
  }
  const snapshot = () => {
    const window = bot.currentWindow || bot.inventory
    const width = bot.currentWindow ? 3 : 2
    return { ...ui, ...radar.snapshot(), inventoryOpen: ui.inventoryOpen || Boolean(bot.currentWindow),
      health: bot.health, food: bot.food, level: bot.experience.level, dimension:bot.game.dimension, position: bot.entity?.position,
      inventory: window.slots.slice(window.inventoryStart,window.inventoryEnd).map(serialize),
      hotbar: window.slots.slice(window.inventoryEnd-9,window.inventoryEnd).map(serialize), selected: bot.quickBarSlot,
      armor: armor(), armorSlots: bot.inventory.slots.slice(5,9).map(serialize),
      windowType: bot.currentWindow?.type || 'inventory',
      container: bot.currentWindow && /generic_9x|chest|container/.test(window.type) ? {slots:window.slots.slice(0,window.inventoryStart).map(serialize)} : null,
      furnace: bot.currentWindow?.type.includes('furnace') ? { input:serialize(window.slots[0]),fuel:serialize(window.slots[1]),output:serialize(window.slots[2]),progress:window.progress || 0 } : null,
      craftWidth: width, craftSlots: window.slots.slice(1, 1 + width * width).map(serialize),
      result: serialize(window.slots[0]) }
  }
  async function equip (name, destination = 'hand') {
    const enchantScore=item=>(item.enchants||[]).some(e=>e.name==='silk_touch')?-100:(item.enchants||[]).reduce((score,e)=>score+e.lvl*({fortune:5,efficiency:3,unbreaking:1}[e.name]||0),0)
    const matches=bot.inventory.items().filter(item=>item.name===name)
    const usable=destination==='hand'?matches.filter(item=>!item.maxDurability||item.maxDurability-(item.durabilityUsed||0)>=16):matches
    const item = (usable.length?usable:matches)
      .sort((a,b)=>enchantScore(b)-enchantScore(a)||(a.durabilityUsed||0)-(b.durabilityUsed||0))[0]
    if (!item) throw new Error(`Нет предмета: ${name}`)
    if(destination==='hand'&&bot.heldItem?.slot===item.slot)return
    await bot.equip(item, destination)
    await bot.waitForTicks(1)
    if (bot.supportFeature('stateIdUsed')) await limited(bot._syncWindow(bot.inventory),3000)
  }
  async function goto (p) {
    await limited(bot.pathfinder.goto(new goals.GoalLookAtBlock(p, bot.world, { reach: 4 })), 10000)
    await bot.lookAt(p.offset(.5, .5, .5))
  }
  async function dig (block) {
    if (!block || !bot.canDigBlock(block)) throw new Error('Блок недоступен для добычи.')
    const p = block.position
    if(protectedBase(p))throw new Error('Блок находится в защищённой зоне базы.')
    if (hazardous(block) || hazardous(bot.blockAt(p.offset(0, 1, 0)))) throw new Error('Небезопасный блок.')
    if ([new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),new Vec3(0,0,1),new Vec3(0,0,-1)]
      .some(v => /water|lava/.test(bot.blockAt(p.plus(v))?.name || ''))) throw new Error('Рядом жидкость.')
    if (stone(block) || /_ore$/.test(block.name) || /deepslate|granite|andesite|diorite|tuff|netherrack|ancient_debris|obsidian/.test(block.name)) {
      const strong=/diamond_ore|gold_ore|redstone_ore|emerald_ore|obsidian|ancient_debris/.test(block.name)
      const required=/ancient_debris|obsidian/.test(block.name)?['netherite','diamond']:strong?['netherite','diamond','iron']:/iron_ore|lapis_ore|copper_ore/.test(block.name)?['netherite','diamond','iron','stone']:['netherite','diamond','iron','stone','wooden']
      const usable=item=>!item.maxDurability||item.maxDurability-(item.durabilityUsed||0)>=16
      const material=required.find(name=>bot.inventory.items().some(item=>item.name===`${name}_pickaxe`&&usable(item)&&!item.enchants?.some(e=>e.name==='silk_touch'))) || required.find(name=>bot.inventory.items().some(item=>item.name===`${name}_pickaxe`&&usable(item)))
      if(!material)throw new Error(`Нет подходящей кирки для ${block.name}.`)
      await equip(`${material}_pickaxe`)
    }
    else if (/dirt|grass_block|podzol/.test(block.name)) {const material=['netherite','diamond','iron','stone','wooden'].find(m=>count(`${m}_shovel`));if(material)await equip(`${material}_shovel`)}
    else if (/log|leaves|crafting_table|chest/.test(block.name)) {const material=['netherite','diamond','iron','stone','wooden'].find(m=>count(`${m}_axe`));if(material)await equip(`${material}_axe`)}
    try { await limited(bot.dig(block), 12000) } finally { bot.stopDigging() }
    if(bot.blockAt(p)?.type===block.type)await bot.waitForTicks(2)
    if (bot.blockAt(p)?.type === block.type) throw new Error(`Сервер не подтвердил добычу: ${block.name}`)
  }
  async function pickup () {
    const item = bot.nearestEntity(entity => entity.name === 'item' &&
      ['cobblestone', 'cobbled_deepslate'].includes(droppedItem(entity)?.name) &&
      (blocked.get(`item:${entity.id}`) || 0) < Date.now() &&
      entity.position.distanceTo(bot.entity.position) < 6)
    if (!item) return false
    const p = item.position
    const before = count('cobblestone') + count('cobbled_deepslate')
    try {
      await limited(bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,0)), 6000)
      await bot.waitForTicks(2)
    } catch(error) { console.error(error.message) }
    const picked = count('cobblestone') + count('cobbled_deepslate') > before
    if (!picked) blocked.set(`item:${item.id}`, Date.now()+30000)
    return picked
  }
  async function craft (name, repetitions = 1) {
    const item = bot.registry.itemsByName[name]
    if (!item || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 8) throw new Error('Неверный рецепт.')
    const needsTable = /^(wooden|stone|iron|diamond|netherite)_/.test(name) || ['furnace','chest','gold_ingot','smithing_table','bucket'].includes(name)
    const craftingTable = needsTable ? table() : null
    if (needsTable && !craftingTable) throw new Error('Верстак не найден.')
    if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 3.5) await goto(craftingTable.position)
    const recipe = bot.recipesFor(item.id, null, 1, craftingTable)[0]
    if (!recipe) throw new Error(`Недостаточно материалов: ${name}`)
    ui.inventoryOpen = true
    ui.crafting = name
    try {
      await bot.waitForTicks(2)
      for (let i = 0; i < repetitions; i++) {
        const current = bot.recipesFor(item.id, null, 1, craftingTable)[0]
        if (!current) throw new Error(`Недостаточно материалов: ${name}`)
        const before = count(name)
        await limited(bot.craft(current, 1, craftingTable), 16000)
        await bot.waitForTicks(3)
        if (count(name) < before + current.result.count) throw new Error(`Сервер не подтвердил крафт: ${name}`)
      }
      await bot.waitForTicks(2)
    } finally { ui.inventoryOpen = false; ui.crafting = null }
  }
  async function placeBlock (name = 'crafting_table', local = false) {
    const known = name === 'crafting_table' ? table() : bot.findBlock({matching:block=>block?.name===name,maxDistance:8})
    if (known && (!local || known.position.distanceTo(bot.entity.position)<4.5&&bot.canSeeBlock(known))) return
    if(known&&protectedBase(bot.entity.position)){
      await goto(known.position)
      if(bot.canSeeBlock(bot.blockAt(known.position)))return
      throw new Error(`Рабочий блок на базе недоступен: ${name}.`)
    }
    if (!count(name)) await craft(name)
    await equip(name)
    const feet = bot.entity.position.floored()
    const candidates = []
    function scan () {
      candidates.length = 0
      for (let dx=-3;dx<=3;dx++) for(let dz=-3;dz<=3;dz++) for(let dy=-1;dy<=1;dy++) {
      const target = feet.offset(dx,dy,dz)
      if (dx===0 && dz===0) continue
      const pos = bot.entity.position
      if(target.x < pos.x+.35 && target.x+1 > pos.x-.35 && target.z < pos.z+.35 && target.z+1 > pos.z-.35 && target.y < pos.y+1.85 && target.y+1 > pos.y)continue
      const base = bot.blockAt(target.offset(0,-1,0))
      if (solid(base) && bot.blockAt(target)?.name === 'air' && bot.blockAt(target.offset(0,1,0))?.name === 'air' &&
        bot.entity.position.distanceTo(target) < 4) candidates.push({ target, base })
      }
    }
    scan()
    if (!candidates.length) {
      for (const vector of [new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)]) {
        try {
          for (let distance=1;distance<=2;distance++) {
            const cell=feet.plus(vector.scaled(distance))
            if(!solid(bot.blockAt(cell.offset(0,-1,0))))throw new Error('Нет опоры для рабочей площадки.')
            for(const p of [cell.offset(0,1,0),cell]){
              const block=bot.blockAt(p)
              if(['crafting_table','furnace'].includes(block?.name))throw new Error('Здесь уже стоит рабочий блок.')
              if(block?.boundingBox==='block')await dig(block)
            }
          }
          scan()
          if(candidates.length)break
        }catch(error){console.error(error.message)}
      }
    }
    candidates.sort((a,b)=>a.target.distanceTo(feet)-b.target.distanceTo(feet))
    for (const candidate of candidates) {
      try {
        await equip(name)
        await bot.lookAt(candidate.base.position.offset(.5,1,.5))
        await limited(bot.placeBlock(candidate.base,new Vec3(0,1,0)),5000)
        if (bot.blockAt(candidate.target)?.name === name) {
          if (name === 'crafting_table') tablePosition = candidate.target.clone()
          return
        }
      } catch (error) { console.error(error.message) }
    }
    throw new Error(`Не удалось поставить блок: ${name}`)
  }
  function safeStep (feet, vector) {
    const dest = feet.plus(vector).offset(0,-1,0)
    const positions = [dest.offset(0,2,0),dest.offset(0,1,0),dest]
    if (!solid(bot.blockAt(dest.offset(0,-1,0)))) return null
    for (const p of positions) {
      const block = bot.blockAt(p)
      if (hazardous(block) || block?.name === 'crafting_table' || !block || block.hardness < 0) return null
      if ([new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),new Vec3(0,0,1),new Vec3(0,0,-1)]
        .some(v => /water|lava|gravel|sand$/.test(bot.blockAt(p.plus(v))?.name || ''))) return null
    }
    return { dest, positions }
  }
  async function stair () {
    if (depth >= 24) throw new Error('Лимит спуска достигнут: поставь бота ближе к камню.')
    const feet = bot.entity.position.floored()
    const directions = direction ? [direction] : [new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)]
    let step
    for (const vector of directions) {
      step = safeStep(feet,vector)
      if (step) { direction=vector; break }
    }
    if (!step) throw new Error('Безопасный ступенчатый спуск не найден.')
    route.push(feet.clone())
    for (const p of step.positions) {
      const block = bot.blockAt(p)
      if (block.boundingBox === 'block') await dig(block)
    }
    await limited(bot.pathfinder.goto(new goals.GoalBlock(step.dest.x,step.dest.y,step.dest.z)),6000)
    depth++
    await bot.waitForTicks(12)
  }
  async function mine () {
    if (await pickup()) return
    const positions = bot.findBlocks({ matching: block => stone(block), maxDistance: 16, count: 200,
      useExtraInfo: block => block.position.y >= bot.entity.position.y - 3 &&
        (blocked.get(key(block.position))||0)<Date.now() &&
        [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,0,1),new Vec3(0,0,-1)]
          .some(v=>bot.blockAt(block.position.plus(v))?.name==='air') })
    positions.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
    const feet = bot.entity.position.floored()
    for (const p of positions.slice(0,3)) {
      if (p.x===feet.x && p.z===feet.z && p.y<feet.y) continue
      try {
        let block = bot.blockAt(p)
        if (!bot.canDigBlock(block) || !bot.canSeeBlock(block)) await goto(p)
        block = bot.blockAt(p)
        if (!block || !stone(block) || !bot.canSeeBlock(block)) throw new Error('Камень закрыт.')
        await dig(block)
        await pickup()
        return
      } catch(error) { blocked.set(key(p),Date.now()+60000); console.error(error.message) }
    }
    await stair()
  }
  async function returnTable () {
    const craftingTable = table()
    if (!craftingTable) throw new Error('Верстак потерян.')
    try { await goto(craftingTable.position); return } catch(error) { console.error(error.message) }
    for (const p of [...route].reverse()) {
      await limited(bot.pathfinder.goto(new goals.GoalBlock(p.x,p.y,p.z)),7000)
    }
    await goto(craftingTable.position)
  }
  async function handle (request) {
    if(request.command==='configure_portals'){
      const portals=request.portals
      if(!portals||typeof portals!=='object'||Array.isArray(portals))throw new Error('Некорректные координаты портала.')
      for(const [dimension,p] of Object.entries(portals)){
        if(!['overworld','the_nether'].includes(dimension)||!p||![p.x,p.y,p.z].every(Number.isInteger)||Math.abs(p.x)>30000000||Math.abs(p.z)>30000000||p.y<(dimension==='the_nether'?0:-64)||p.y>(dimension==='the_nether'?255:320))throw new Error('Некорректные координаты портала.')
      }
      ui.portalOverrides=JSON.parse(JSON.stringify(portals))
      return true
    }
    if(request.command==='sustain'){
      if(bot.food>=18)return false
      const foods=['cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','cooked_salmon','cooked_cod','bread','baked_potato','carrot','apple','melon_slice']
      const item=foods.map(name=>bot.inventory.items().find(item=>item.name===name)).find(Boolean)
      if(!item)return false
      await bot.equip(item,'hand')
      await limited(bot.consume(),6000)
      return true
    }
    if (request.command === 'configure_home') {
      const p=request.home
      if(!p||![p.x,p.y,p.z].every(Number.isInteger)||p.y < -64||p.y > 320)throw new Error('Некорректные координаты дома.')
      ui.home=p
      return true
    }
    if (request.command === 'status') { ui.stage = String(request.text).slice(0,200); return true }
    if (request.command === 'inventory') { ui.inventoryOpen=Boolean(request.open); return true }
    if (request.command === 'craft') await craft(request.item,request.count||1)
    else if (request.command === 'place_table') await placeBlock('crafting_table',request.local)
    else if (request.command === 'mine_stone') return extension.handle({command:'mine_resource',resource:'stone'})
    else if (request.command === 'return_table') await returnTable()
    else if (request.command === 'equip') await equip(request.item,request.destination || 'hand')
    else if (request.command === 'place_chest') await placeBlock('chest',true)
    else if (request.command === 'pack_table') {const block=table();if(block&&block.position.distanceTo(bot.entity.position)<5&&!protectedBase(block.position)){await goto(block.position);await dig(block);await bot.waitForTicks(10);const item=bot.nearestEntity(e=>e.name==='item'&&droppedItem(e)?.name==='crafting_table'&&e.position.distanceTo(bot.entity.position)<6);if(item)await limited(bot.pathfinder.goto(new goals.GoalNear(item.position.x,item.position.y,item.position.z,0)),6000);if(!count('crafting_table'))throw new Error('Верстак не подобран.');tablePosition=null}}
    else if (request.command === 'place_furnace') await placeBlock('furnace',true)
    else if (request.command === 'place_workbench' && ['smithing_table','crafting_table','furnace'].includes(request.item)) await placeBlock(request.item,true)
    else if (['enchant_pickaxe','combine_pickaxes','build_portal','portal_status','enter_portal','smith_upgrade','find_template'].includes(request.command)) return endgame.handle(request)
    else if (extension) return extension.handle(request)
    else throw new Error('Неизвестный навык.')
    return true
  }
  const extension = require('./iron-skills')(bot,{ limited,blocked,key,count,equip,dig,goto,solid,hazardous,protectedBase,ui,radar,placeBlock,craft,returnWorld:()=>endgame.returnOverworld(),packTable:()=>handle({command:'pack_table'}) })
  const endgame = require('./endgame-skills')(bot,{limited,count,goto,equip,ui})
  return { handle, snapshot, count, table, ui, armor, items, radar,protectedBase }
}
