'use strict'
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const droppedItem = require('./dropped-item')

module.exports = (bot, skills) => {
  const {limited,blocked,key,count,dig,goto,solid,hazardous,ui,radar,placeBlock,craft,packTable} = skills
  const vectors = [new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)]
  let heading = vectors[0]
  let furnace = null
  let smeltOutput = 'iron_ingot'
  const visited = new Map()
  const trail = []
  let dimension=bot.game?.dimension || 'overworld'
  ui.miningTrail??={}
  function appendTrail(p){
    const index=trail.findIndex(previous=>previous.equals(p))
    if(index>=0)trail.splice(index+1)
    else trail.push(p.clone())
  }
  const restoreTrail=()=>{trail.length=0;for(const p of (ui.miningTrail[dimension]||[]).slice(-4096))if([p.x,p.y,p.z].every(Number.isFinite))appendTrail(new Vec3(p.x,p.y,p.z))}
  const saveTrail=()=>{ui.miningTrail[dimension]=trail.map(p=>({x:p.x,y:p.y,z:p.z}))}
  restoreTrail()
  saveTrail()
  let activeTarget = null
  let veinQueue=[]
  let pendingOutcome=null
  let plannerBatch=null
  let selectedResource=null
  let obsidianMovements=null
  const oreVariants=resource=>['ancient_debris','obsidian'].includes(resource)?[resource]:[`${resource}_ore`,`deepslate_${resource}_ore`,...(resource==='gold'?['nether_gold_ore']:resource==='quartz'?['nether_quartz_ore']:[])]
  function miningCandidates(resource){
    if(!['diamond','iron','coal','gold','lapis','redstone','copper','emerald','quartz','ancient_debris','obsidian'].includes(resource))throw new Error('Неизвестная руда для Qwen.')
    const variants=oreVariants(resource)
    const eligible=p=>variants.includes(bot.blockAt(p)?.name)&&!skills.protectedBase?.(p)&&(blocked.get(`ore:${key(p)}`)||0)<Date.now()&&
      ![...vectors,new Vec3(0,1,0),new Vec3(0,-1,0)].some(v=>/water|lava/.test(bot.blockAt(p.plus(v))?.name||''))
    const active=activeTarget?.resource===resource&&eligible(activeTarget.position)
    const remaining=selectedResource===resource&&veinQueue.some(eligible)
    if(active||remaining||ui.pendingLoot||resource==='obsidian'&&factory.active())return {resource,active:true,candidates:[]}
    let ranked=policy.candidates(variants).filter(c=>eligible(c.position)).slice(0,6)
    if(resource==='obsidian'&&bot.pathfinder.getPathTo){
      if(!obsidianMovements)obsidianMovements=require('./navigation')(bot,{returning:true,home:ui.home,protectedBase:skills.protectedBase})
      ranked=ranked.filter(c=>{
        c.routeStatus=bot.pathfinder.getPathTo(obsidianMovements,new goals.GoalLookAtBlock(c.position,bot.world,{reach:4}),75).status
        return c.routeStatus!=='noPath'
      })
    }
    if(resource==='obsidian'&&!ranked.length){const offer=factory.offer();if(offer)ranked=[offer]}
    plannerBatch={resource,dimension:bot.game.dimension,at:Date.now(),origin:bot.entity.position.clone(),candidates:ranked}
    return {resource,dimension:bot.game.dimension,position:bot.entity.position,candidates:ranked.map(c=>c.kind==='create_obsidian'?c:({id:c.id,kind:'mine',routeStatus:c.routeStatus,position:c.position,
      blocks:c.blocks.length,distance:Math.round(c.position.distanceTo(bot.entity.position)*10)/10,seconds:Math.round(c.seconds),
      solid:c.features[3],hard:c.features[4],fluid:c.features[5],unknown:c.features[6],visited:c.features[9],score:Math.round(c.score*1000)/1000}))}
  }
  function miningSelect(request){
    if(!plannerBatch||plannerBatch.resource!==request.resource||plannerBatch.dimension!==bot.game.dimension||Date.now()-plannerBatch.at>120000)throw new Error('Кандидаты Qwen устарели.')
    const candidate=plannerBatch.candidates.find(c=>c.id===request.target_id)
    if(candidate?.kind==='create_obsidian'){
      if(request.resource!=='obsidian')throw new Error('Создание разрешено только для обсидиана.')
      factory.select();activeTarget=null;veinQueue=[];plannerBatch=null
      ui.qwenPlanner={model:'Qwen3-1.7B-Q8_0',target:request.target_id,strategy:'create_obsidian',decisions:(ui.qwenPlanner?.decisions||0)+1}
      return {accepted:true,target:request.target_id,strategy:'create_obsidian'}
    }
    const fresh=candidate&&policy.describe(candidate.blocks,oreVariants(request.resource)).find(c=>c.blocks.some(p=>p.equals(candidate.position)))
    if(!fresh||(blocked.get(`ore:${key(candidate.position)}`)||0)>Date.now())throw new Error('Жила Qwen больше недоступна или небезопасна.')
    selectedResource=request.resource
    veinQueue=candidate.blocks
    activeTarget={resource:request.resource,position:candidate.position,stalls:0,last:bot.entity.position.clone(),best:candidate.position.distanceTo(bot.entity.position),detours:0,candidate}
    plannerBatch=null
    ui.qwenPlanner={model:'Qwen3-1.7B-Q8_0',target:request.target_id,decisions:(ui.qwenPlanner?.decisions||0)+1}
    radar.setTarget({name:bot.blockAt(candidate.position)?.name,position:candidate.position})
    return {accepted:true,target:request.target_id}
  }
  const policy=require('./ore-policy')(bot,skills)
  const mineRoute=require('./mine-route')(bot,skills)
  const goHome=require('./progress-goto')(bot,limited)
  ui.miningMetrics={collected:0,seconds:0,targets:0,failures:0}
  let delivery = null
  ui.stashes=[]
  bot.on?.('spawn',()=>{if(dimension!==bot.game.dimension){saveTrail();dimension=bot.game.dimension;restoreTrail();visited.clear();activeTarget=null;radar.setTarget(null)}})
  const storedResource = name => /(_ore|_ore$|^raw_|^deepslate_.*_ore$)/.test(name) ||
    ['diamond','iron_ingot','gold_ingot','coal','charcoal','lapis_lazuli','redstone','emerald','quartz','ancient_debris','obsidian','netherite_scrap','netherite_ingot','copper_ingot'].includes(name)
  async function homeWithdraw(requested={},food=0){
    const home=ui.home,center=new Vec3(home.x,home.y,home.z)
    if(!['overworld','minecraft:overworld'].includes(bot.game.dimension)||bot.entity.position.distanceTo(center)>16)
      throw new Error('Пополнение запасов доступно возле базы в обычном мире.')
    for(const [name,amount] of Object.entries(requested))
      if(!bot.registry.itemsByName[name]||!Number.isInteger(amount)||amount<0||amount>512)throw new Error('Некорректный запрос запасов.')
    const foods=['cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','cooked_salmon','cooked_cod','bread','baked_potato','carrot','apple']
    const total=name=>bot.inventory.items().filter(item=>item.name===name).reduce((sum,item)=>sum+item.count,0)
    const foodCount=()=>bot.inventory.items().filter(item=>foods.includes(item.name)).reduce((sum,item)=>sum+item.count,0)
    const positions=bot.findBlocks({matching:block=>['chest','trapped_chest','barrel'].includes(block?.name),maxDistance:24,count:32,
      useExtraInfo:block=>block.position.distanceTo(center)<12&&block.getProperties?.().type!=='right'})
    positions.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
    const taken={}
    for(const position of positions){
      if(foodCount()>=food&&Object.entries(requested).every(([name,amount])=>total(name)>=amount))break
      try{await goto(position)}catch(error){continue}
      const chest=await limited(bot.openContainer(bot.blockAt(position)),6000)
      try{
        for(const item of chest.containerItems()){
          const needed=Math.max(0,(requested[item.name]||0)-total(item.name))
          const foodNeeded=foods.includes(item.name)?Math.max(0,food-foodCount()):0
          const amount=Math.min(item.count,Math.max(needed,foodNeeded))
          if(!amount)continue
          await limited(chest.withdraw(item.type,item.metadata,amount,item.nbt),10000)
          taken[item.name]=(taken[item.name]||0)+amount
        }
      }finally{chest.close();await bot.waitForTicks(3)}
    }
    return {taken,food:foodCount()}
  }
  async function homeDeposit (requestedHome, reserve = {}, archive = false) {
    const terrain=name=>/^(cobblestone|cobbled_deepslate|stone|deepslate|granite|diorite|andesite|tuff|dirt|grass_block|gravel|netherrack|basalt|smooth_basalt|blackstone|mossy_cobblestone|sandstone|calcite|amethyst_block|amethyst_shard)$/.test(name)
    if(archive)reserve={cobblestone:64,cobbled_deepslate:32,netherrack:16,dirt:16,...reserve}
    const home=requestedHome||ui.home
    if(!home||![home.x,home.y,home.z].every(Number.isFinite))throw new Error('Задай координаты базы X Y Z.')
    if(bot.game.dimension!=='overworld'&&bot.game.dimension!=='minecraft:overworld'){
      try{await skills.returnWorld()}
      catch(error){
        for(const p of [...trail].reverse()){
          if(p.distanceTo(bot.entity.position)<1)continue
          await limited(bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,1)),8000)
        }
        await skills.returnWorld()
      }
    }
    if(bot.health<=8||bot.entity.isInLava)throw new Error('Сначала восстанови здоровье перед дорогой домой.')
    ui.home=home
    ui.stage=`Возвращаюсь домой · X ${home.x} Y ${home.y} Z ${home.z}`
    const origin=bot.entity.position.clone()
    if(trail.length&&origin.y<home.y-8){
      ui.mineResume={dimension:bot.game.dimension,origin:{x:origin.x,y:origin.y,z:origin.z},points:trail.map(p=>({x:p.x,y:p.y,z:p.z}))}
      await mineRoute.follow(trail,true)
    }
    try{
      await goHome(new goals.GoalNear(home.x,home.y,home.z,3),30000)
    }catch(error){
      let planned=false
      const previous=bot.pathfinder.movements
      const thinking=bot.pathfinder.thinkTimeout
      if(previous&&bot.pathfinder.setMovements){
        const danger=()=>{if(bot.health<=8||bot.entity.isInLava)bot.pathfinder.setGoal(null)}
        try{
          ui.stage='Восстанавливаю обратный путь: проходы и опоры'
          bot.pathfinder.setMovements(require('./navigation')(bot,{returning:true,protectedBase:skills.protectedBase,home}))
          bot.pathfinder.thinkTimeout=15000
          bot.on('health',danger)
          if(bot.entity.position.y<home.y){
            const exits=require('./home-exits')(bot,home)
            if(exits.length)await goHome(new goals.GoalCompositeAny(exits.map(p=>new goals.GoalBlock(p.x,p.y,p.z))),300000)
            else{
              const dx=origin.x-home.x,dz=origin.z-home.z,length=Math.hypot(dx,dz)||1
              const outside=new Vec3(Math.floor(home.x+dx/length*20),home.y+1,Math.floor(home.z+dz/length*20))
              await goHome(new goals.GoalNear(outside.x,outside.y,outside.z,1),300000)
            }
          }
          await goHome(new goals.GoalNear(home.x,home.y,home.z,3),180000)
          planned=true
        }catch(failure){console.error(`Обратный маршрут: ${failure.message}`)}
        finally{bot.removeListener('health',danger);bot.pathfinder.setMovements(previous);bot.pathfinder.thinkTimeout=thinking}
      }
      if(bot.health<=8||bot.entity.isInLava)throw new Error('Возврат остановлен: здоровье или лава.')
      if(!planned){
      if(trail.length){
        const nearest=trail.reduce((best,p,index)=>p.distanceTo(bot.entity.position)<trail[best].distanceTo(bot.entity.position)?index:best,0)
        for(let index=nearest;index>=0 && bot.entity.position.distanceTo(new Vec3(home.x,home.y,home.z))>5;index--){
          const p=trail[index]
          if(p.distanceTo(bot.entity.position)<1)continue
          try{await limited(bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,1)),8000)}catch(failure){break}
        }
      }
      const goal=new goals.GoalNear(home.x,home.y,home.z,3)
      let reached=false
      let failures=0
      for(let attempt=0;attempt<160;attempt++){
        if(bot.health<=8||bot.entity.isInLava)throw new Error('Выход из шахты остановлен: мало здоровья или лава.')
        if(attempt%4===0){
          const route=bot.pathfinder.getPathFromTo?.(bot.pathfinder.movements,bot.entity.position,goal,{timeout:200,tickTimeout:200}).next().value.result
          if(!route||route.status==='success'||route.status==='partial'&&bot.entity.position.y>=home.y-2){
            try{await goHome(goal,15000);reached=true;break}catch(failure){}
          }
        }
        const p=bot.entity.position
        const dx=p.x-home.x,dz=p.z-home.z,length=Math.hypot(dx,dz)||1
        const outside=new Vec3(home.x+dx/length*16,home.y+1,home.z+dz/length*16)
        ui.stage='Восстанавливаю ступенчатый выход из шахты'
        try{await step(outside);failures=0}
        catch(failure){console.error(`Выход из шахты: ${failure.message}`);if(++failures>=8)throw failure}
      }
      if(!reached)throw new Error('Выход из шахты не найден безопасно; маршрут и инвентарь сохранены.')
      }
    }
    const chests=[]
    for(let y=home.y-3;y<=home.y+3;y++)for(let x=home.x-10;x<=home.x+10;x++)for(let z=home.z-10;z<=home.z+10;z++){
      const p=new Vec3(x,y,z), block=bot.blockAt(p)
      if(block && ['chest','trapped_chest','barrel'].includes(block.name) && p.distanceTo(new Vec3(home.x,home.y,home.z))<=10)chests.push(p)
    }
    if(chests.length<2)throw new Error(`У базы найдено ${chests.length} сундуков; нужно хотя бы два.`)
    chests.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
    const deposited={}
    const archived=new Set()
    if(archive){
      const ranking=['wooden','golden','stone','iron','diamond','netherite']
      const armorRanking=['leather','golden','chainmail','iron','diamond','netherite']
      for(const [suffix,slot] of [['helmet',5],['chestplate',6],['leggings',7],['boots',8]]){
        const equipped=bot.inventory.slots?.[slot]
        if(!equipped?.name.endsWith(`_${suffix}`))continue
        for(const item of bot.inventory.items())if(item.name.endsWith(`_${suffix}`)&&!item.enchants?.length&&armorRanking.indexOf(item.name.split('_')[0])<armorRanking.indexOf(equipped.name.split('_')[0]))archived.add(item.slot)
      }
      for(const suffix of ['pickaxe','axe','shovel','sword']){
        const tools=bot.inventory.items().filter(item=>item.name.endsWith(`_${suffix}`))
        const best=tools.sort((a,b)=>ranking.indexOf(b.name.split('_')[0])-ranking.indexOf(a.name.split('_')[0])||(a.durabilityUsed||0)-(b.durabilityUsed||0))[0]
        const ordinary=tools.filter(item=>!item.enchants?.length&&(!item.maxDurability||item.maxDurability-(item.durabilityUsed||0)>=32)).slice(0,suffix==='pickaxe'?2:1)
        for(const item of tools){
          const incompatible=suffix==='pickaxe'&&(item.enchants||[]).some(e=>e.name==='silk_touch')
          if(best&&(!item.enchants?.length&&item!==best&&!ordinary.includes(item)||incompatible&&tools.some(other=>other.slot!==item.slot&&ranking.indexOf(other.name.split('_')[0])>=ranking.indexOf(item.name.split('_')[0])&&!other.enchants?.some(e=>e.name==='silk_touch'))))archived.add(item.slot)
        }
      }
    }
    const canStore=item=>storedResource(item.name)||archived.has(item.slot)||archive&&terrain(item.name)
    const totals=()=>bot.inventory.items().reduce((sum,item)=>{sum[item.name]=(sum[item.name]||0)+item.count;return sum},{})
    for(const position of chests){
      const amounts=totals()
      const pending=bot.inventory.items().some(item=>canStore(item)&&amounts[item.name]>(reserve[item.name]||0))
      if(!pending)break
      try{await goto(position)}catch(error){continue}
      const chest=await limited(bot.openContainer(bot.blockAt(position)),6000)
      ui.inventoryOpen=true
      try{
        const kept={...reserve}
        for(const original of [...bot.inventory.items()]){
          if(!canStore(original))continue
          const current=bot.inventory.items().find(item=>item.slot===original.slot)
          if(!current)continue
          const retain=Math.min(current.count,kept[current.name]||0)
          kept[current.name]=Math.max(0,(kept[current.name]||0)-retain)
          const amount=current.count-retain
          if(!amount)continue
          const free=chest.slots.slice(0,chest.inventoryStart).reduce((total,slot)=>total+(!slot?current.stackSize:slot.type===current.type&&slot.metadata===current.metadata&&!slot.nbt&&!current.nbt?Math.max(0,current.stackSize-slot.count):0),0)
          if(!free)continue
          const moved=Math.min(amount,free)
          await limited(chest.deposit(current.type,current.metadata,moved,current.nbt),16000)
          if(bot.supportFeature('stateIdUsed'))await limited(bot._syncWindow(chest),3000)
          deposited[current.name]=(deposited[current.name]||0)+moved
        }
      }finally{chest.close();await bot.waitForTicks(3);ui.inventoryOpen=false}
    }
    const remaining=Object.entries(bot.inventory.items().filter(canStore).reduce((sum,item)=>{sum[item.name]=(sum[item.name]||0)+item.count;return sum},{})).reduce((sum,[name,amount])=>sum+Math.max(0,amount-(reserve[name]||0)),0)
    const total=Object.values(deposited).reduce((sum,n)=>sum+n,0)
    ui.stage=`Домашний сундук · сложено ${total}`
    console.error(`Дом X ${home.x} Y ${home.y} Z ${home.z}: сложено ${total}, осталось ${remaining}.`)
    return {done:true,deposited,remaining,chests:chests.length,origin:{x:origin.x,y:origin.y,z:origin.z}}
  }
  const ore = block => block && ['iron_ore','deepslate_iron_ore'].includes(block.name)
  const resources = ['raw_iron','iron_ore','deepslate_iron_ore']
  const loot=require('./loot')(bot,{limited,count,ui,approach:target=>step(target)})
  const factory=require('./obsidian-casting')(bot,{...skills,homeWithdraw,craft,remember:loot.remember,pickup})
  async function harvest(block,wanted){
    loot.remember(wanted,block.position)
    try{await dig(block)}catch(error){if(bot.blockAt(block.position)?.name===block.name)ui.pendingLoot=null;throw error}
    await pickup(wanted)
    finishOutcome()
  }
  function finishOutcome(){
    if(!pendingOutcome)return
    const gathered=pendingOutcome.wanted.reduce((sum,name)=>sum+Math.max(0,count(name)-(pendingOutcome.before[name]||0)),0)
    if(!gathered)return
    const seconds=(Date.now()-pendingOutcome.started)/1000
    policy.outcome(pendingOutcome.target,seconds,gathered)
    ui.miningMetrics.collected+=gathered;ui.miningMetrics.seconds+=seconds;ui.miningMetrics.targets++
    pendingOutcome=null
  }
  async function compactInventory(){
    if(!bot.toss)return {released:0}
    let released=0,keptStone=0,keptDirt=0
    for(const item of [...bot.inventory.items()]){
      if(!/^(cobblestone|cobbled_deepslate|stone|deepslate|granite|diorite|andesite|tuff|dirt|gravel)$/.test(item.name))continue
      const stone=['cobblestone','cobbled_deepslate'].includes(item.name),dirt=item.name==='dirt'
      const reserve=stone?Math.max(0,64-keptStone):dirt?Math.max(0,32-keptDirt):0,retain=Math.min(item.count,reserve)
      if(stone)keptStone+=retain
      if(dirt)keptDirt+=retain
      const amount=item.count-retain
      if(amount>0){await limited(bot.toss(item.type,item.metadata,amount),6000);released+=amount}
    }
    return {released}
  }
  async function pickup (wanted = resources) {
    return loot.pickup(wanted)
  }
  function stepPlan (vector, changeY = 0) {
    const feet=bot.entity.position.floored()
    const destination=feet.plus(vector).offset(0,changeY,0)
    if(destination.y < -60 || !solid(bot.blockAt(destination.offset(0,-1,0)))) return null
    const positions=changeY<0?[destination.offset(0,2,0),destination.offset(0,1,0),destination]:changeY>0?[feet.offset(0,2,0),destination.offset(0,1,0),destination]:[destination.offset(0,1,0),destination]
    for(const p of positions){
      const block=bot.blockAt(p)
      if(skills.protectedBase?.(p)&&block?.boundingBox==='block')return null
      if(!block||hazardous(block)||block.hardness<0||['crafting_table','furnace','chest','trapped_chest'].includes(block.name))return null
      if(block.boundingBox==='block'&&/^(sand|red_sand|gravel)$/.test(bot.blockAt(p.offset(0,1,0))?.name||''))return null
      if([...vectors,new Vec3(0,1,0),new Vec3(0,-1,0)].some(v=>/water|lava/.test(bot.blockAt(p.plus(v))?.name||'')))return null
    }
    return {destination,positions,vector}
  }
  async function step (target = null, searchLevel = 16) {
    const feet=bot.entity.position.floored()
    let choices=[heading,...vectors.filter(v=>!v.equals(heading))]
    if(target)choices=[...vectors].sort((a,b)=>feet.plus(a).distanceTo(target)-feet.plus(b).distanceTo(target))
    const changeY=target?(target.y<feet.y-.5?-1:target.y>feet.y+.5?1:0):feet.y>searchLevel?-1:0
    const plans=[]
    for(const vector of choices){
      if((blocked.get(`step:${key(feet)}:${key(vector)}`)||0)>Date.now())continue
      const desired=stepPlan(vector,changeY)
      if(desired)plans.push(desired)
      if(changeY){const flat=stepPlan(vector,0);if(flat)plans.push(flat)}
    }
    if(changeY<0&&!plans.some(plan=>plan.destination.y<feet.y)){
      for(const vector of choices){
        if((blocked.get(`step:${key(feet)}:${key(vector)}`)||0)>Date.now())continue
        const detour=stepPlan(vector,1)
        if(detour)plans.push(detour)
      }
    }
    plans.sort((a,b)=>{
      const score=p=>(target?p.destination.distanceTo(target):p.vector.equals(heading)?0:2)+
        (visited.get(key(p.destination))||0)*8+(p.destination.y===feet.y&&changeY?3:0)
      return score(a)-score(b)
    })
    const plan=plans[0]
    if(!plan)throw new Error('Нет безопасного прохода: вода, обрыв или сыпучие блоки.')
    try{
      for(const p of plan.positions){const block=bot.blockAt(p);if(block.boundingBox==='block')await dig(block)}
      await limited(bot.pathfinder.goto(new goals.GoalBlock(plan.destination.x,plan.destination.y,plan.destination.z)),6000)
      appendTrail(feet)
      appendTrail(plan.destination)
      if(trail.length>4096)trail.splice(0,512)
      saveTrail()
      heading=plan.vector
      visited.set(key(plan.destination),(visited.get(key(plan.destination))||0)+1)
      if(visited.size>4096)for(const p of [...visited.keys()].slice(0,512))visited.delete(p)
      for(const [p,expires] of blocked)if(expires<Date.now())blocked.delete(p)
      await bot.waitForTicks(1)
    }catch(error){blocked.set(`step:${key(feet)}:${key(plan.vector)}`,Date.now()+60000);throw error}
  }
  async function mineResource (resource = 'iron') {
    finishOutcome()
    if(resource==='obsidian'&&factory.active())return factory.step()
    const home=ui.home
    if(ui.mineResume&&ui.mineResume.dimension===bot.game.dimension&&home&&bot.entity.position.distanceTo(new Vec3(home.x,home.y,home.z))<20){
      const resume=ui.mineResume
      ui.mineResume=null
      if(await mineRoute.follow(resume.points,false))return
    }
    if(home&&['overworld','minecraft:overworld'].includes(bot.game?.dimension)&&bot.entity.position.y>=home.y-5&&Math.hypot(bot.entity.position.x-home.x,bot.entity.position.z-home.z)<12){
      const candidates=[]
      for(const distance of [16,20,24])for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])for(let y=home.y+8;y>=home.y-8;y--){
        const p=new Vec3(home.x+dx*distance,y,home.z+dz*distance)
        if(solid(bot.blockAt(p.offset(0,-1,0)))&&['air','cave_air'].includes(bot.blockAt(p)?.name)&&['air','cave_air'].includes(bot.blockAt(p.offset(0,1,0))?.name))
          candidates.push(p)
      }
      candidates.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
      for(const p of candidates.slice(0,8)){
        try{await limited(bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z,1)),10000);return}
        catch(error){console.error(error.message)}
      }
      throw new Error('Не найден безопасный выход из защищённой зоны базы.')
    }
    if(resource==='flint'){
      if(await pickup(['flint']))return
      const feet=bot.entity.position.floored()
      const positions=bot.findBlocks({matching:block=>block?.name==='gravel',maxDistance:24,count:128,
        useExtraInfo:block=>!skills.protectedBase?.(block.position)&&block.position.y<=feet.y+1&&block.position.y>=feet.y-3&&
          !(block.position.x===feet.x&&block.position.z===feet.z)&&
          bot.blockAt(block.position.offset(0,-1,0))?.boundingBox==='block'&&
          !vectors.some(v=>/lava|water/.test(bot.blockAt(block.position.plus(v))?.name||''))})
      positions.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
      const position=positions[0]
      if(!position){await step(null,16);return}
      if(!bot.canSeeBlock(bot.blockAt(position)))await goto(position)
      const block=bot.blockAt(position)
      if(!block||block.name!=='gravel'||!bot.canDigBlock(block))return
      const shovel=['netherite','diamond','iron','stone','wooden'].find(name=>count(`${name}_shovel`))
      if(shovel)await skills.equip(`${shovel}_shovel`)
      try{await limited(bot.dig(block),12000)}finally{bot.stopDigging()}
      await bot.waitForTicks(10)
      await pickup(['flint'])
      return
    }
    if(resource==='diamond'&&bot.inventory.emptySlotCount()<=7){await compactInventory();if(bot.inventory.emptySlotCount()<=7)await cacheResources()}
    const variants=resource==='wood'?Object.keys(bot.registry.blocksByName).filter(name=>/(_log|_stem)$/.test(name)):resource==='stone'?['stone','deepslate']:['ancient_debris','obsidian','netherrack'].includes(resource)?[resource]:[`${resource}_ore`,`deepslate_${resource}_ore`,...(resource==='gold'?['nether_gold_ore']:resource==='quartz'?['nether_quartz_ore']:[])]
    const drops={iron:['raw_iron',...variants],copper:['raw_copper',...variants],gold:['raw_gold','gold_nugget',...variants],diamond:['diamond',...variants],coal:['coal',...variants],redstone:['redstone',...variants],lapis:['lapis_lazuli',...variants],emerald:['emerald',...variants],quartz:['quartz',...variants],obsidian:['obsidian'],stone:['cobblestone','cobbled_deepslate']}
    if(await pickup(drops[resource]||variants))return
    const feet=bot.entity.position.floored()
    const freshlyEmpty=plannerBatch?.resource===resource&&plannerBatch.dimension===bot.game.dimension&&!plannerBatch.candidates.length&&Date.now()-plannerBatch.at<2000&&plannerBatch.origin.distanceTo(bot.entity.position)<1.5
    if(activeTarget && (activeTarget.resource!==resource || !variants.includes(bot.blockAt(activeTarget.position)?.name) || (blocked.get(`ore:${key(activeTarget.position)}`)||0)>Date.now()))activeTarget=null
    if(!activeTarget&&selectedResource===resource){
      const position=veinQueue.find(p=>variants.includes(bot.blockAt(p)?.name)&&!skills.protectedBase?.(p)&&(blocked.get(`ore:${key(p)}`)||0)<Date.now()&&
        ![...vectors,new Vec3(0,1,0),new Vec3(0,-1,0)].some(v=>/water|lava/.test(bot.blockAt(p.plus(v))?.name||'')))
      if(position)activeTarget={resource,position,stalls:0,last:bot.entity.position.clone(),best:position.distanceTo(bot.entity.position),detours:0}
    }
    if(!activeTarget&&resource==='diamond'&&!freshlyEmpty){
      const nearby=veinQueue.filter(p=>(blocked.get(`ore:${key(p)}`)||0)<Date.now()&&variants.includes(bot.blockAt(p)?.name)&&p.distanceTo(bot.entity.position)<12&&
        !vectors.some(v=>/water|lava/.test(bot.blockAt(p.plus(v))?.name||''))&&!(p.x===feet.x&&p.z===feet.z&&p.y<feet.y))
      nearby.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
      let candidate,position=nearby[0]
      if(!position){candidate=policy.select(variants);position=candidate?.position;veinQueue=candidate?.blocks||[]}
      else candidate=policy.describe(veinQueue,variants).find(c=>c.blocks.some(p=>p.equals(position)))
      if(position){
        activeTarget={resource,position,stalls:0,last:bot.entity.position.clone(),best:position.distanceTo(bot.entity.position),detours:0,candidate}
        if(candidate)pendingOutcome={target:activeTarget,started:Date.now(),wanted:drops[resource],before:Object.fromEntries(drops[resource].map(name=>[name,count(name)]))}
      }
    }
    if(!activeTarget&&resource!=='diamond'&&!freshlyEmpty){
      const positions=bot.findBlocks({matching:b=>b&&variants.includes(b.name),maxDistance:64,count:512,
        useExtraInfo:b=>!skills.protectedBase?.(b.position)&&(blocked.get(`ore:${key(b.position)}`)||0)<Date.now()&&
          ![...vectors,new Vec3(0,1,0),new Vec3(0,-1,0)].some(v=>/water|lava/.test(bot.blockAt(b.position.plus(v))?.name||''))})
      positions.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
      const position=positions.find(p=>!(p.x===feet.x&&p.z===feet.z&&p.y<feet.y)||resource!=='stone'&&solid(bot.blockAt(p.offset(0,-1,0))))
      if(position)activeTarget={resource,position,stalls:0,last:bot.entity.position.clone(),best:position.distanceTo(bot.entity.position),detours:0}
    }
    radar.setTarget(activeTarget?{name:bot.blockAt(activeTarget.position)?.name,position:activeTarget.position}:null)
    if(!activeTarget){
      if(resource==='wood')throw new Error('Деревья не видны в загруженных чанках. Подойди к лесу.')
      if(resource==='obsidian'&&factory.offer()){factory.select();return factory.step()}
      await step(null,resource==='diamond'?-58:resource==='ancient_debris'?15:resource==='obsidian'?-54:16);return
    }
    const target=activeTarget.position
    const distance=target.distanceTo(bot.entity.position)
    if(distance<activeTarget.best-.25){activeTarget.best=distance;activeTarget.detours=0}
    else activeTarget.detours++
    if(activeTarget.detours>24){
      policy.outcome(activeTarget,(Date.now()-(pendingOutcome?.started||Date.now()))/1000,0,'Нет продвижения')
      pendingOutcome=null;ui.miningMetrics.failures++
      blocked.set(`ore:${key(target)}`,Date.now()+120000)
      ui.lastRecovery='Нет продвижения к жиле: переключаю цель'
      ui.recoveries=(ui.recoveries||0)+1
      console.error(ui.lastRecovery)
      activeTarget=null;radar.setTarget(null);return
    }
    try{
      const eye=bot.entity.position.offset(0,bot.entity.eyeHeight||1.62,0)
      const direction=target.offset(.5,.5,.5).minus(eye)
      const obstruction=bot.world.raycast(eye,direction.clone().normalize(),Math.min(4.8,direction.norm()+.1))
      if(obstruction&&solid(obstruction)&&bot.canDigBlock(obstruction)&&!skills.protectedBase?.(obstruction.position)&&!['crafting_table','furnace','chest','trapped_chest'].includes(obstruction.name)){
        const p=obstruction.position
        if((p.y>=feet.y||p.equals(target)&&!(p.x===feet.x&&p.z===feet.z&&p.y<feet.y))&&!(target.y>feet.y+1&&p.y===feet.y&&!p.equals(target))){
          if(variants.includes(obstruction.name))await harvest(obstruction,drops[resource]||variants)
          else{await dig(obstruction);await pickup(drops[resource]||variants)}
          if(p.equals(target)){activeTarget=null;radar.setTarget(null)}
          return
        }
      }
      if(target.x===feet.x&&target.z===feet.z&&target.y>=feet.y+2){
        for(let y=feet.y+2;y<=Math.min(target.y,feet.y+4);y++){
          const ceiling=bot.blockAt(new Vec3(feet.x,y,feet.z))
          if(solid(ceiling)&&bot.canDigBlock(ceiling)&&bot.canSeeBlock(ceiling)&&!skills.protectedBase?.(ceiling.position)){await dig(ceiling);return}
        }
      }
      let block=bot.blockAt(target)
      if(bot.canDigBlock(block)&&bot.canSeeBlock(block)&&!(target.x===feet.x&&target.z===feet.z&&target.y<feet.y)){
        await harvest(block,drops[resource]||variants)
        if(variants.includes(bot.blockAt(target)?.name))throw new Error('Сервер не подтвердил добычу руды.')
        activeTarget=null;radar.setTarget(null);return
      }
      if(target.distanceTo(bot.entity.position)<8 && vectors.some(v=>bot.blockAt(target.plus(v))?.name==='air')){
        try{await goto(target)}catch(error){console.error(error.message)}
        block=bot.blockAt(target)
        if(variants.includes(block?.name)&&bot.canDigBlock(block)&&bot.canSeeBlock(block)&&!(target.x===feet.x&&target.z===feet.z&&target.y<feet.y)){await harvest(block,drops[resource]||variants);activeTarget=null;return}
      }
      await step(target)
      activeTarget.stalls=bot.entity.position.distanceTo(activeTarget.last)<.5?activeTarget.stalls+1:0
      activeTarget.last=bot.entity.position.clone()
      if(activeTarget.stalls>5)throw new Error('Нет продвижения к выбранной жиле.')
    }catch(error){
      if(/жидкость|Небезопасный|Нет безопасного прохода/.test(error.message)){
        blocked.set(`ore:${key(target)}`,Date.now()+60000);activeTarget=null;radar.setTarget(null);return
      }
      if(activeTarget){activeTarget.stalls++;if(activeTarget.stalls>5){blocked.set(`ore:${key(target)}`,Date.now()+30000);activeTarget=null;radar.setTarget(null)}}
      throw error
    }
  }
  function selectPlayer (name) {
    const players=radar.playerList()
    if(name){const found=players.find(p=>p.name===name);if(!found)throw new Error(`Игрок ${name} не найден. Подойди к боту.`);return found}
    if(players.length!==1)throw new Error('Укажи ник получателя: в мире несколько игроков или игрок ещё не виден.')
    return players[0]
  }
  async function cacheResources () {
    let chestBlock=bot.findBlock({matching:b=>b?.name==='chest',maxDistance:6,useExtraInfo:b=>bot.canSeeBlock(b)})
    if(!chestBlock){
      await placeBlock('crafting_table',true)
      if(!count('chest'))await craft('chest')
      await placeBlock('chest',true)
      await packTable()
      chestBlock=bot.findBlock({matching:b=>b?.name==='chest',maxDistance:6,useExtraInfo:b=>bot.canSeeBlock(b)})
    }
    if(!chestBlock)throw new Error('Нет места в рюкзаке. Нажми «Сложить ресурсы в сундук».')
    const carried=[...bot.inventory.items()], keep=new Set()
    for(const tool of ['pickaxe','axe','shovel','sword']){
      const best=carried.filter(i=>i.name.endsWith(`_${tool}`)).sort((a,b)=>['wooden','golden','stone','iron','diamond','netherite'].indexOf(b.name.split('_')[0])-['wooden','golden','stone','iron','diamond','netherite'].indexOf(a.name.split('_')[0])||(a.durabilityUsed||0)-(b.durabilityUsed||0))[0]
      if(best)keep.add(best.slot)
    }
    const stone=carried.find(i=>['cobblestone','cobbled_deepslate'].includes(i.name))
    if(stone)keep.add(stone.slot)
    await goto(chestBlock.position)
    const chest=await limited(bot.openContainer(chestBlock),6000)
    ui.inventoryOpen=true
    let deposited=0
    try{
      for(const item of carried){
        if(keep.has(item.slot)||!(/^(cobblestone|cobbled_deepslate|granite|diorite|andesite|tuff|dirt|gravel)$/.test(item.name)||/_(pickaxe|axe|shovel|sword)$/.test(item.name)))continue
        await limited(chest.deposit(item.type,item.metadata,item.count,item.nbt),16000)
        if(bot.supportFeature('stateIdUsed'))await limited(bot._syncWindow(chest),3000)
        deposited+=item.count
      }
    }finally{chest.close();await bot.waitForTicks(3);ui.inventoryOpen=false}
    if(bot.inventory.emptySlotCount()<=7)throw new Error('Рюкзак переполнен; нужен свободный сундук.')
    if(!ui.stashes.some(p=>p.position.equals(chestBlock.position)))ui.stashes.push({position:chestBlock.position.clone(),name:'Сундук запасов',seen:Date.now()})
    console.error(`Запасы: ${deposited} предметов в сундуке X ${chestBlock.position.x} Y ${chestBlock.position.y} Z ${chestBlock.position.z}.`)
  }
  async function deliverStep (name) {
    const player=selectPlayer(name)
    if(!delivery)delivery={name:player.name,origin:bot.entity.position.clone(),done:false}
    if(bot.entity.position.distanceTo(player.position)>3.5||Math.abs(bot.entity.position.y-player.position.y)>1.5){
      ui.stage=`Иду к ${player.name} · ${Math.round(bot.entity.position.distanceTo(player.position))} м`
      try{
        await limited(bot.pathfinder.goto(new goals.GoalNear(player.position.x,player.position.y,player.position.z,2)),12000)
        if(Math.abs(bot.entity.position.y-player.position.y)>1.5)await step(player.position)
      }catch(error){
        if(trail.length){
          let nearest=0
          for(let i=1;i<trail.length;i++)if(trail[i].distanceTo(bot.entity.position)<trail[nearest].distanceTo(bot.entity.position))nearest=i
          const back=trail[Math.max(0,nearest-1)]
          if(back.distanceTo(bot.entity.position)>1){
            try{await limited(bot.pathfinder.goto(new goals.GoalBlock(back.x,back.y,back.z)),6000);return {done:false}}
            catch(error){console.error(error.message)}
          }
        }
        await step(player.position)
      }
      return {done:false}
    }
    const chests=bot.findBlocks({matching:b=>['chest','trapped_chest'].includes(b?.name),maxDistance:12,count:16,
      useExtraInfo:b=>b.position.distanceTo(player.position)<7})
    if(!chests.length){
      if(!count('chest')){await placeBlock('crafting_table',true);await craft('chest')}
      await placeBlock('chest',true)
      return {done:false}
    }
    const keep=new Set()
    for(const tool of ['pickaxe','axe','shovel','sword']){
      const item=bot.inventory.items().filter(i=>i.name.endsWith(`_${tool}`)).sort((a,b)=>
        ['wooden','golden','stone','iron','diamond','netherite'].indexOf(b.name.split('_')[0])-['wooden','golden','stone','iron','diamond','netherite'].indexOf(a.name.split('_')[0]) || (a.durabilityUsed||0)-(b.durabilityUsed||0))[0]
      if(item)keep.add(item.slot)
    }
    let deposited=0,remaining=0
    for(const position of chests){
      await goto(position)
      const chest=await limited(bot.openContainer(bot.blockAt(position)),6000)
      ui.inventoryOpen=true
      try{
        for(const original of [...bot.inventory.items()]){
          if(keep.has(original.slot))continue
          const item=chest.items().find(i=>i.name===original.name)
          if(!item)continue
          const free=chest.slots.slice(0,chest.inventoryStart).reduce((n,s)=>n+(!s?item.stackSize:s.type===item.type&&s.metadata===item.metadata&&!s.nbt&&!item.nbt?Math.max(0,item.stackSize-s.count):0),0)
          const amount=Math.min(item.count,free)
          if(amount){await limited(chest.deposit(item.type,item.metadata,amount,item.nbt),16000);if(bot.supportFeature('stateIdUsed'))await limited(bot._syncWindow(chest),3000);deposited+=amount}
        }
      }finally{chest.close();await bot.waitForTicks(3);ui.inventoryOpen=false}
    }
    remaining=bot.inventory.items().filter(i=>!keep.has(i.slot)).reduce((n,i)=>n+i.count,0)
    if(remaining)throw new Error(`Сложено ${deposited}. Сундуки заполнены, осталось ${remaining} предметов.`)
    ui.stage=`Ресурсы сложены в сундук у ${player.name}`
    delivery=null
    return {done:true,deposited,player:player.name}
  }
  async function sync () {if(bot.supportFeature('stateIdUsed'))await limited(bot._syncWindow(furnace),3000)}
  async function startSmelt (amount, material='iron') {
    const inputs=material==='ancient_debris'?['ancient_debris']:material==='gold'?['raw_gold','gold_ore','deepslate_gold_ore']:resources
    smeltOutput=material==='ancient_debris'?'netherite_scrap':material==='gold'?'gold_ingot':'iron_ingot'
    const block=bot.findBlock({matching:block=>block?.name==='furnace',maxDistance:8})
    if(!block)throw new Error('Печь не найдена рядом.')
    await goto(block.position)
    furnace=await limited(bot.openFurnace(block),6000)
    ui.inventoryOpen=true
    await sync()
    if(furnace.outputItem())await furnace.takeOutput()
    if(furnace.inputItem()&&!inputs.includes(furnace.inputItem().name))await furnace.takeInput()
    await sync()
    const input=inputs.find(name=>count(name)>0)
    if(!input && !furnace.inputItem())throw new Error(`Нет сырья для плавки: ${material}.`)
    const smelts=Math.min(amount,(furnace.inputItem()?.count||0)+(input?count(input):0))
    const fuels=[['coal',8],['charcoal',8],...(bot.currentWindow||bot.inventory).items().filter(item=>item.name.endsWith('_planks')).map(item=>[item.name,1.5])]
    let needed=smelts
    if(furnace.fuelItem()){
      const existing=fuels.find(([name])=>name===furnace.fuelItem().name)
      if(existing)needed-=furnace.fuelItem().count*existing[1]
    }
    const fuel=fuels.find(([name,burn])=>count(name)*burn>=needed)
    if(needed>0&&!fuel)throw new Error('Недостаточно угля или досок для плавки.')
    if(fuel&&needed>0){
      if(furnace.fuelItem()&&furnace.fuelItem().name!==fuel[0]){await furnace.takeFuel();await sync()}
      const wanted=Math.ceil(needed/fuel[1])
      const initial=furnace.fuelItem()?.count||0
      for(let retry=0;retry<3;retry++){
        const missing=initial+wanted-(furnace.fuelItem()?.count||0)
        if(missing<=0)break
        await limited(furnace.putFuel(bot.registry.itemsByName[fuel[0]].id,null,missing),10000)
        await sync()
      }
    }
    if(input){
      const wanted=Math.min(smelts-(furnace.inputItem()?.count||0),count(input))
      if(wanted>0){await limited(furnace.putInput(bot.registry.itemsByName[input].id,null,wanted),10000);await sync()}
    }
    return smeltTick()
  }
  async function smeltTick () {
    if(!furnace||bot.currentWindow!==furnace)throw new Error('Окно печи закрыто.')
    await sync()
    if(furnace.outputItem()) {await limited(furnace.takeOutput(),6000);await sync()}
    return {ingots:count('iron_ingot'),output:count(smeltOutput),input:furnace.inputItem()?.count||0,fuel:furnace.fuelItem()?.count||0,progress:furnace.progress||0}
  }
  async function closeFurnace () {
    if(furnace&&bot.currentWindow===furnace){await sync();await furnace.close();await bot.waitForTicks(3)}
    furnace=null;ui.inventoryOpen=false
  }
  async function recoverFurnace () {
    const block=bot.findBlock({matching:block=>block?.name==='furnace',maxDistance:8})
    if(!block)return false
    await goto(block.position)
    furnace=await limited(bot.openFurnace(block),6000)
    ui.inventoryOpen=true
    await sync()
    if(furnace.outputItem())await furnace.takeOutput()
    if(furnace.inputItem()&&resources.includes(furnace.inputItem().name))await furnace.takeInput()
    if(furnace.fuelItem())await furnace.takeFuel()
    await sync()
    await closeFurnace()
    return true
  }
  async function handle(request){
    if(request.command==='xp_resource'){
      const resources=['the_nether','minecraft:the_nether'].includes(bot.game.dimension)?[['quartz',3.5]]:[['coal',1],['redstone',3],['lapis',3.5],['diamond',5]]
      const choices=[]
      for(const [resource,xp] of resources)for(const c of policy.candidates(oreVariants(resource)).slice(0,3))choices.push({resource,score:c.blocks.length*xp/Math.max(1,c.seconds)})
      choices.sort((a,b)=>b.score-a.score)
      return choices[0]||{resource:resources[0][0],score:0}
    }
    else if(request.command==='obsidian_status')return {active:factory.active(),plan:ui.obsidianFactory||null,offer:factory.offer()}
    else if(request.command==='mining_candidates')return miningCandidates(request.resource)
    else if(request.command==='mining_select')return miningSelect(request)
    else if(request.command==='mining_debug'){
      const feet=bot.entity.position.floored(),cells=[]
      for(let x=-3;x<=3;x++)for(let y=-4;y<=2;y++)for(let z=-3;z<=3;z++){
        const p=feet.offset(x,y,z),block=bot.blockAt(p)
        cells.push({position:{x:p.x,y:p.y,z:p.z},name:block?.name,solid:block?.boundingBox,hardness:block?.hardness})
      }
      return {position:bot.entity.position,cells,plans:vectors.map(v=>({vector:v,down:stepPlan(v,-1),flat:stepPlan(v,0),up:stepPlan(v,1)})),target:activeTarget,visited:[...visited.entries()]}
    }
    else if(request.command==='mining_capture')return policy.capture(request)
    else if(request.command==='mining_reload'){policy.reload();return ui.miningPolicy}
    else if(request.command==='mining_compact')return compactInventory()
    else if(request.command==='collect_loot'){await factory.prepareCollection();const handled=await pickup(request.items||['diamond']);factory.confirmCollection();finishOutcome();return {handled,pending:ui.pendingLoot}}
    else if(request.command==='mine_iron')await mineResource('iron')
    else if(request.command==='mine_resource')await mineResource(request.resource)
    else if(request.command==='deliver_step')return deliverStep(request.player)
    else if(request.command==='home_deposit')return homeDeposit(request.home,request.reserve,request.archive)
    else if(request.command==='home_withdraw')return homeWithdraw(request.items,request.food)
    else if(request.command==='delivery_cancel'){delivery=null;return true}
    else if(request.command==='smelt_start')return startSmelt(request.count||24,request.resource||'iron')
    else if(request.command==='smelt_tick')return smeltTick()
    else if(request.command==='furnace_close')await closeFurnace()
    else if(request.command==='furnace_recover')return recoverFurnace()
    else throw new Error('Неизвестный навык.')
    return true
  }
  return {handle}
}
