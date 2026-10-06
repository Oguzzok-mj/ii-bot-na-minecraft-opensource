'use strict'
const { once } = require('node:events')
const Item = require('prismarine-item')
const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

module.exports = (bot, skills) => {
  const {limited,count,goto,equip,ui}=skills
  const levels={efficiency:5,fortune:3,unbreaking:3}
  const score=item=>Object.entries(levels).reduce((sum,[name,max])=>sum+Math.min(max,item.enchants?.find(e=>e.name===name)?.lvl||0),0)
  const complete=item=>Object.entries(levels).every(([name,max])=>(item.enchants?.find(e=>e.name===name)?.lvl||0)>=max)
  async function enchantPickaxe(){
    if(bot.experience.level<30)throw new Error(`Для зачарования нужно 30 уровней, сейчас ${bot.experience.level}.`)
    if(count('lapis_lazuli')<3)throw new Error('Нужно хотя бы 3 лазурита.')
    const pick=bot.inventory.items().find(item=>item.name==='diamond_pickaxe' && !item.enchants?.length)
    if(!pick)throw new Error('Нужна новая незачарованная алмазная кирка.')
    const block=bot.findBlock({matching:block=>block?.name==='enchanting_table',maxDistance:32})
    if(!block)throw new Error('Рядом нет стола зачарования.')
    await goto(block.position)
    const table=await limited(bot.openEnchantmentTable(bot.blockAt(block.position)),6000)
    ui.inventoryOpen=true
    try{
      await limited(table.putTargetItem(pick),8000)
      const lapis=bot.inventory.items().find(item=>item.name==='lapis_lazuli')
      await limited(table.putLapis(lapis),8000)
      if(table.enchantments.some(option=>option.level<0))await limited(once(table,'ready'),6000)
      const choices=table.enchantments.map((option,index)=>({index,...option})).filter(option=>option.level>0&&option.level<=bot.experience.level)
      const choice=choices.sort((a,b)=>b.level-a.level)[0]
      if(!choice)throw new Error('Нет доступного зачарования: проверь полки и опыт.')
      await limited(table.enchant(choice.index),12000)
      await bot.waitForTicks(4)
      const result=table.targetItem()
      if(!result)throw new Error('Стол не вернул кирку после зачарования.')
      const enchants=result.enchants||[]
      await limited(table.takeTargetItem(),8000)
      if(table.slots[1])await limited(bot.putAway(1),8000)
      ui.stage=`Зачарована кирка: ${enchants.map(e=>`${e.name} ${e.lvl}`).join(', ')}`
      return {enchants,level:bot.experience.level,complete:complete(result)}
    }finally{table.close();ui.inventoryOpen=false}
  }
  async function combinePickaxes(){
    const picks=bot.inventory.items().filter(item=>item.name==='diamond_pickaxe'&&item.enchants?.length&&!item.enchants.some(e=>e.name==='silk_touch'))
    if(picks.some(complete))return {complete:true,level:bot.experience.level}
    const itemClass=Item(bot.registry)
    let best=null
    for(const left of picks)for(const right of picks){
      if(left.slot===right.slot)continue
      const result=itemClass.anvil(left,right,false)
      if(!result.item||!result.xpCost||result.xpCost>bot.experience.level)continue
      const gain=score(result.item)-Math.max(score(left),score(right))
      if(gain<=0)continue
      if(!best||gain>best.gain||gain===best.gain&&result.xpCost<best.cost)
        best={left,right,gain,cost:result.xpCost,enchants:result.item.enchants,complete:complete(result.item)}
    }
    if(!best)throw new Error('Пока нечего объединять: нужны дополнительные зачарованные кирки и уровни опыта.')
    const block=bot.findBlock({matching:block=>['anvil','chipped_anvil','damaged_anvil'].includes(block?.name),maxDistance:32})
    if(!block)throw new Error('Рядом нет наковальни.')
    await goto(block.position)
    const anvil=await limited(bot.openAnvil(bot.blockAt(block.position)),6000)
    ui.inventoryOpen=true
    try{await limited(anvil.combine(best.left,best.right),16000)}
    finally{anvil.close();ui.inventoryOpen=false}
    const result=bot.inventory.items().filter(item=>item.name==='diamond_pickaxe').sort((a,b)=>score(b)-score(a))[0]
    if(!result||score(result)<score({enchants:best.enchants}))throw new Error('Наковальня не подтвердила объединение кирок.')
    ui.stage=`Наковальня: ${result.enchants.map(e=>`${e.name} ${e.lvl}`).join(', ')}`
    return {enchants:result.enchants,level:bot.experience.level,complete:complete(result)}
  }
  function portalSite(home){
    const center=new Vec3(home.x,home.y,home.z)
    const sites=[]
    for(let dx=-12;dx<=12;dx++)for(let dz=-12;dz<=12;dz++)for(const direction of ['x','z']){
      const origin=center.offset(dx,0,dz)
      if(origin.distanceTo(center)<7)continue
      const at=(u,v)=>direction==='x'?origin.offset(u,v,0):origin.offset(0,v,u)
      let safe=true
      for(let u=0;u<4&&safe;u++){
        const support=bot.blockAt(at(u,-1))
        if(!support||support.boundingBox!=='block'||/lava|magma|fire/.test(support.name)){safe=false;break}
        for(let v=0;v<5;v++){
          const block=bot.blockAt(at(u,v))
          const interior=u>0&&u<3&&v>0&&v<4
          if(!block||!(interior?['air','cave_air','void_air']:['air','cave_air','void_air','obsidian']).includes(block.name)){safe=false;break}
        }
      }
      if(safe)sites.push({origin,direction,at,distance:origin.distanceTo(center)})
    }
    sites.sort((a,b)=>a.distance-b.distance||a.origin.distanceTo(bot.entity.position)-b.origin.distanceTo(bot.entity.position))
    return sites[0]||null
  }
  async function buildPortal(home=ui.home){
    if(!home)throw new Error('Не указаны координаты дома.')
    const center=new Vec3(home.x,home.y,home.z)
    if(bot.entity.position.distanceTo(center)>30)
      await limited(bot.pathfinder.goto(new (require('mineflayer-pathfinder').goals.GoalNear)(home.x,home.y,home.z,4)),30000)
    const existing=bot.findBlock({matching:block=>block?.name==='nether_portal'&&block.position.distanceTo(center)<20,maxDistance:24})
    if(existing)return {built:true,lit:true,position:existing.position}
    let site=portalSite(home)
    if(ui.portalPlan&&new Vec3(ui.portalPlan.origin.x,ui.portalPlan.origin.y,ui.portalPlan.origin.z).distanceTo(center)<20){
      const origin=new Vec3(ui.portalPlan.origin.x,ui.portalPlan.origin.y,ui.portalPlan.origin.z),direction=ui.portalPlan.direction
      site={origin,direction,at:(u,v)=>direction==='x'?origin.offset(u,v,0):origin.offset(0,v,u)}
    }
    if(!site)throw new Error('У базы нет безопасной площадки 4×5 для портала.')
    ui.portalPlan={origin:{x:site.origin.x,y:site.origin.y,z:site.origin.z},direction:site.direction}
    const frame=[]
    for(let u=0;u<4;u++)frame.push([u,0])
    for(let v=1;v<=3;v++){frame.push([0,v]);frame.push([3,v])}
    for(let u=0;u<4;u++)frame.push([u,4])
    const missing=frame.filter(([u,v])=>bot.blockAt(site.at(u,v))?.name!=='obsidian').length
    if(count('obsidian')<missing)throw new Error(`Для портала нужно ${missing} обсидиана; сейчас ${count('obsidian')}.`)
    for(const [u,v] of frame){
      const target=site.at(u,v)
      if(bot.blockAt(target)?.name==='obsidian')continue
      const reference=v===0?site.at(u,-1):v===4&&u>0&&u<3?site.at(u-1,4):site.at(u,v-1)
      const face=v===0||!(v===4&&u>0&&u<3)?new Vec3(0,1,0):site.direction==='x'?new Vec3(1,0,0):new Vec3(0,0,1)
      const ref=bot.blockAt(reference)
      if(!ref||ref.boundingBox!=='block')throw new Error('Опора портала исчезла; строительство остановлено.')
      await goto(reference)
      await equip('obsidian')
      await bot.lookAt(reference.offset(.5,.5,.5))
      await limited(bot.placeBlock(bot.blockAt(reference),face),6000)
      await bot.waitForTicks(3)
      if(bot.blockAt(target)?.name!=='obsidian')throw new Error('Сервер не подтвердил блок портала.')
      ui.stage=`Портал: ${frame.filter(([x,y])=>bot.blockAt(site.at(x,y))?.name==='obsidian').length}/14`
    }
    if(!count('flint_and_steel'))return {built:true,lit:false,position:site.origin,need:'flint_and_steel'}
    const base=site.at(1,0)
    await goto(base)
    await equip('flint_and_steel')
    await limited(bot.activateBlock(bot.blockAt(base),new Vec3(0,1,0)),6000)
    await bot.waitForTicks(15)
    const lit=bot.blockAt(site.at(1,1))?.name==='nether_portal'
    if(!lit)throw new Error('Рама построена, но портал не загорелся.')
    ui.stage='Портал в Незер готов'
    return {built:true,lit:true,position:site.origin}
  }
  async function enterPortal(){
    const current=bot.game.dimension
    ui.portals??={}
    const dimension=current.replace('minecraft:','')
    const preferred=ui.portalOverrides?.[dimension]
    if(preferred&&bot.entity.position.distanceTo(new Vec3(preferred.x,preferred.y,preferred.z))>5)
      await limited(bot.pathfinder.goto(new goals.GoalNear(preferred.x,preferred.y,preferred.z,2)),30000)
    let block=bot.findBlock({matching:block=>block?.name==='nether_portal'&&(!preferred||block.position.distanceTo(new Vec3(preferred.x,preferred.y,preferred.z))<8),maxDistance:32})
    if(!block&&!preferred&&ui.portals[current]){
      const known=ui.portals[current]
      await limited(bot.pathfinder.goto(new goals.GoalNear(known.x,known.y,known.z,2)),30000)
      block=bot.findBlock({matching:block=>block?.name==='nether_portal',maxDistance:8})
    }
    if(!block)throw new Error('Активный портал не найден рядом.')
    const p=block.position
    ui.portals[current]={x:p.x,y:p.y,z:p.z}
    ui.stage='Вхожу в портал'
    try{await limited(bot.pathfinder.goto(new goals.GoalBlock(p.x,p.y,p.z)),15000)}
    catch(error){if(bot.game.dimension===current)throw error}
    if(bot.game.dimension===current){
      let onSpawn
      try{await limited(new Promise(resolve=>{
        onSpawn=()=>{if(bot.game.dimension!==current)resolve()}
        bot.on('spawn',onSpawn)
      }),30000)}finally{if(onSpawn)bot.removeListener('spawn',onSpawn)}
    }
    await bot.waitForChunksToLoad()
    const next=bot.findBlock({matching:block=>block?.name==='nether_portal',maxDistance:16})
    const nextPosition=next?.position||bot.entity.position.floored()
    ui.portals[bot.game.dimension]={x:nextPosition.x,y:nextPosition.y,z:nextPosition.z}
    ui.stage=`Измерение: ${bot.game.dimension}`
    return {dimension:bot.game.dimension}
  }
  async function smithUpgrade(name){
    if(!/^diamond_(helmet|chestplate|leggings|boots|pickaxe|axe|shovel|sword)$/.test(name))throw new Error('Нужен алмазный предмет для улучшения.')
    const target=name.replace('diamond_','netherite_')
    const template=bot.inventory.items().find(item=>item.name==='netherite_upgrade_smithing_template')
    const destinations={diamond_helmet:'head',diamond_chestplate:'torso',diamond_leggings:'legs',diamond_boots:'feet'}
    if(destinations[name] && bot.inventory.slots[5+['head','torso','legs','feet'].indexOf(destinations[name])]?.name===name)
      await bot.unequip(destinations[name])
    const base=bot.inventory.items().filter(item=>item.name===name).sort((a,b)=>score(b)-score(a))[0]
    const ingot=bot.inventory.items().find(item=>item.name==='netherite_ingot')
    if(!template||!base||!ingot)throw new Error(`Для ${target} нужны шаблон из бастиона, ${name} и незеритовый слиток.`)
    const block=bot.findBlock({matching:block=>block?.name==='smithing_table',maxDistance:32})
    if(!block)throw new Error('Рядом нет кузнечного стола.')
    await goto(block.position)
    const window=await limited(bot.openBlock(bot.blockAt(block.position)),6000)
    ui.inventoryOpen=true
    try{
      if(!/smithing/.test(window.type))throw new Error(`Неожиданное окно кузнечного стола: ${window.type}`)
      for(const [slot,item] of [[0,template],[1,base],[2,ingot]]){
        await limited(bot.transfer({window,itemType:item.type,metadata:item.metadata,count:1,nbt:item.nbt,
          sourceStart:window.inventoryStart,sourceEnd:window.inventoryEnd,destStart:slot,destEnd:slot+1}),8000)
      }
      await bot.waitForTicks(5)
      if(window.slots[3]?.name!==target)throw new Error('Кузнечный стол не подтвердил результат улучшения.')
      await limited(bot.putAway(3),8000)
      await bot.waitForTicks(3)
    }finally{window.close();ui.inventoryOpen=false}
    if(!bot.inventory.items().some(item=>item.name===target))throw new Error('Результат улучшения отсутствует в инвентаре.')
    ui.stage=`Готово: ${target}`
    return {item:target}
  }
  async function findTemplate(){
    const name='netherite_upgrade_smithing_template'
    if(count(name)>=8)return {found:true,count:count(name)}
    const home=ui.home&&new Vec3(ui.home.x,ui.home.y,ui.home.z)
    const atHome=['overworld','minecraft:overworld'].includes(bot.game.dimension)
    const positions=bot.findBlocks({matching:block=>['chest','trapped_chest','barrel'].includes(block?.name),maxDistance:48,count:32,
      useExtraInfo:block=>block.getProperties?.().type!=='right'&&(!atHome||!home||block.position.distanceTo(home)<12)})
    positions.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
    for(const position of positions){
      if(bot.health<=8)throw new Error('Мало здоровья для поиска шаблона.')
      const enemy=bot.nearestEntity(entity=>['piglin_brute','wither_skeleton','blaze','ghast','zombie','skeleton','creeper'].includes(entity.name)&&entity.position.distanceTo(bot.entity.position)<10)
      if(enemy)throw new Error(`Рядом ${enemy.name}; поиск шаблона остановлен.`)
      try{
        await goto(position)
        const chest=await limited(bot.openContainer(bot.blockAt(position)),6000)
        try{
          const template=chest.containerItems().find(item=>item.name===name)
          if(template){await limited(chest.withdraw(template.type,template.metadata,Math.min(8-count(name),template.count),template.nbt),10000);if(count(name)>=8)return {found:true,count:count(name)}}
        }finally{chest.close()}
      }catch(error){console.error(error.message)}
    }
    return {found:count(name)>0,count:count(name)}
  }
  async function handle(request){
    if(request.command==='enchant_pickaxe')return enchantPickaxe()
    if(request.command==='combine_pickaxes')return combinePickaxes()
    if(request.command==='build_portal')return buildPortal(request.home)
    if(request.command==='portal_status'){
      const preferred=ui.portalOverrides?.[bot.game.dimension.replace('minecraft:','')]
      if(preferred){
        const center=new Vec3(preferred.x,preferred.y,preferred.z)
        if(bot.entity.position.distanceTo(center)>5)await limited(bot.pathfinder.goto(new goals.GoalNear(center.x,center.y,center.z,2)),25000)
        const found=bot.findBlock({matching:block=>block?.name==='nether_portal'&&block.position.distanceTo(center)<8,maxDistance:12})
        if(!found)throw new Error('По указанным координатам активный портал не найден. Проверь вкладку «портал».')
        return {lit:true,position:found.position}
      }
      const home=ui.home,center=new Vec3(home.x,home.y,home.z)
      const found=bot.findBlock({matching:block=>block?.name==='nether_portal'&&block.position.distanceTo(center)<20,maxDistance:24})
      return {lit:Boolean(found),position:found?.position||null}
    }
    if(request.command==='enter_portal')return enterPortal()
    if(request.command==='smith_upgrade')return smithUpgrade(request.item)
    if(request.command==='find_template')return findTemplate()
    throw new Error('Неизвестный навык.')
  }
  return {handle,returnOverworld:async()=>{
    if(['overworld','minecraft:overworld'].includes(bot.game.dimension))return
    if(!['the_nether','minecraft:the_nether','nether'].includes(bot.game.dimension))throw new Error('Возврат домой из этого измерения не поддерживается.')
    const result=await enterPortal()
    if(!['overworld','minecraft:overworld'].includes(result.dimension))throw new Error('Портал не привёл в обычный мир.')
  }}
}
