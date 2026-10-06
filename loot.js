'use strict'
const {goals}=require('mineflayer-pathfinder')
const {Vec3}=require('vec3')
const droppedItem=require('./dropped-item')

module.exports=(bot,{limited,count,ui,approach})=>{
  const valuable=['diamond','raw_iron','raw_gold','raw_copper','coal','lapis_lazuli','redstone','emerald','quartz','ancient_debris','netherite_scrap','obsidian']
  const air=p=>['air','cave_air','void_air'].includes(bot.blockAt(p)?.name)
  const safe=p=>{
    if(!air(p)||!air(p.offset(0,1,0))||bot.blockAt(p.offset(0,-1,0))?.boundingBox!=='block')return false
    return ![[0,0,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(o=>/lava|water|fire|magma_block/.test(bot.blockAt(p.offset(...o))?.name||''))
  }
  const gained=p=>p.wanted.some(name=>count(name)>(p.before[name]||0))
  function remember(wanted,position){
    ui.pendingLoot={wanted,position:{x:position.x,y:position.y,z:position.z},before:Object.fromEntries(wanted.map(name=>[name,count(name)])),attempts:0,dimension:bot.game?.dimension}
  }
  async function pickup(wanted){
    let pending=ui.pendingLoot
    if(pending&&pending.dimension!==bot.game?.dimension){ui.pendingLoot=null;pending=null}
    if(pending&&gained(pending)){ui.pendingLoot=null;return true}
    const accepted=new Set([...valuable,...wanted,...(pending?.wanted||[])])
    const entities=Object.values(bot.entities||{}).filter(e=>e.name==='item'&&accepted.has(droppedItem(e)?.name)&&e.position.distanceTo(bot.entity.position)<32)
    if(!entities.length&&bot.nearestEntity){const e=bot.nearestEntity(e=>e.name==='item'&&accepted.has(droppedItem(e)?.name)&&e.position.distanceTo(bot.entity.position)<32);if(e)entities.push(e)}
    entities.sort((a,b)=>(droppedItem(a)?.name==='diamond'?-100:0)+a.position.distanceTo(bot.entity.position)-(droppedItem(b)?.name==='diamond'?-100:0)-b.position.distanceTo(bot.entity.position))
    const entity=entities[0]
    if(!entity&&!pending)return false
    const item=entity&&droppedItem(entity)
    if(entity&&!pending){remember([item.name],entity.position);pending=ui.pendingLoot}
    const target=entity?.position||new Vec3(pending.position.x+.5,pending.position.y+.2,pending.position.z+.5)
    const start=bot.entity.position.clone()
    const distanceBefore=start.distanceTo(target)
    ui.stage=`Подбираю ${item?.displayName||item?.name||pending.wanted[0]}`
    if(bot.health<=8||bot.entity.isInLava)throw new Error('Подбор остановлен: здоровье или лава.')
    if(bot.inventory.emptySlotCount?.()===0&&item&&!bot.inventory.items().some(i=>i.name===item.name&&i.count<(i.stackSize||64)))throw new Error('Для подбора руды нужен свободный слот; разгрузи инвентарь.')
    for(let tick=0;tick<4;tick++){
      if(gained(pending)){ui.pendingLoot=null;return true}
      if(entity&&Math.hypot(target.x-bot.entity.position.x,target.z-bot.entity.position.z)>1.2)break
      await bot.waitForTicks(1)
    }
    const feet=target.floored(),candidates=[]
    for(let y=-1;y<=0;y++)for(const [x,z] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
      const p=feet.offset(x,y,z)
      if(safe(p)&&Math.hypot(p.x+.5-target.x,p.z+.5-target.z)<1.15)candidates.push(p)
    }
    candidates.sort((a,b)=>a.distanceTo(start)-b.distanceTo(start))
    let moved=false
    for(const p of candidates.slice(0,3)){
      try{await limited(bot.pathfinder.goto(new goals.GoalBlock(p.x,p.y,p.z)),4000);moved=true;break}catch(error){}
    }
    if(!moved&&approach)await approach(target)
    for(let tick=0;tick<8;tick++){
      if(gained(pending)){ui.pendingLoot=null;return true}
      await bot.waitForTicks(1)
    }
    pending.attempts=bot.entity.position.distanceTo(target)<distanceBefore-.2?0:pending.attempts+1
    if(pending.attempts>=4)throw new Error(`Руда выпала, но ещё не подобрана (${pending.wanted[0]}). Подбор сохранён; новое месторождение не выбирается.`)
    return true
  }
  return {remember,pickup}
}
