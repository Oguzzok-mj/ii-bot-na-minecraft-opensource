'use strict'
const {Vec3}=require('vec3')
const {goals}=require('mineflayer-pathfinder')
const sides=[new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)]
const air=b=>b&&['air','cave_air','void_air'].includes(b.name)
const stone=b=>b&&/^(stone|deepslate|cobblestone|cobbled_deepslate|granite|diorite|andesite|tuff|blackstone|basalt|smooth_basalt|obsidian)$/.test(b.name)
const ground=b=>b?.boundingBox==='block'&&b.hardness>=0&&!/sand$|gravel|wood|_log$|_planks$|ice|snow|magma|chest|barrel|furnace|table|anvil|bookshelf|leaves/.test(b.name)
const source=(b,name)=>b?.name===name&&Number(b.getProperties?.().level)===0
const xyz=p=>({x:p.x,y:p.y,z:p.z})
const vector=p=>new Vec3(p.x,p.y,p.z)

module.exports=(bot,skills)=>{
  const {ui,count,limited,equip,dig,protectedBase}=skills
  const usablePick=()=>bot.inventory.items().some(item=>['diamond_pickaxe','netherite_pickaxe'].includes(item.name)&&(!item.maxDurability||item.maxDurability-(item.durabilityUsed||0)>=8))
  let movements
  const fluids=new Map()
  let fluidRevision=0
  bot.on?.('blockUpdate',(oldBlock,newBlock)=>{if(/^(water|lava)$/.test(oldBlock?.name||'')||/^(water|lava)$/.test(newBlock?.name||''))fluidRevision++})
  const route=p=>{
    if(bot.entity.position.distanceTo(p)<1.2)return true
    if(!bot.pathfinder.getPathTo)return false
    if(!movements)movements=require('./navigation')(bot,{home:ui.home,protectedBase})
    const result=bot.pathfinder.getPathTo(movements,new goals.GoalBlock(p.x,p.y,p.z),75)
    return result.status==='success'
  }
  const healthy=()=>{
    if(bot.health<=8||bot.food<=6||bot.entity.isInLava)throw new Error('Создание обсидиана остановлено: здоровье, голод или лава.')
    if(Object.values(bot.entities||{}).some(e=>e.position&&['creeper','zombie','skeleton'].includes(e.name)&&e.position.distanceTo(bot.entity.position)<5))throw new Error('Создание обсидиана остановлено: рядом опасный моб.')
    if(!['overworld','minecraft:overworld'].includes(bot.game.dimension))throw new Error('Создание обсидиана водой доступно только в обычном мире.')
  }
  function safeStand(p){
    return air(bot.blockAt(p))&&air(bot.blockAt(p.offset(0,1,0)))&&ground(bot.blockAt(p.offset(0,-1,0)))&&
      [new Vec3(0,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),...sides].every(v=>{
        const b=bot.blockAt(p.plus(v));return b&&!/lava|water|fire|magma_block/.test(b.name)
      })
  }
  function visible(p,eye){
    const delta=p.offset(.5,.5,.5).minus(eye)
    if(delta.norm()>4.5)return false
    const hit=bot.world.raycast(eye,delta.normalize(),eye.distanceTo(p.offset(.5,.5,.5))-.15)
    return !hit||hit.position.equals(p)
  }
  function bank(p){
    const choices=[]
    for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)for(let dy=0;dy<=2;dy++){
      const stand=p.offset(dx,dy,dz)
      if(safeStand(stand)&&visible(p,stand.offset(.5,1.62,.5)))choices.push(stand)
    }
    choices.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
    return choices.find(route)
  }
  function findFluid(name){
    const p=bot.entity.position
    const signature=`${bot.game.dimension}:${name}:${Math.floor(p.x/4)},${Math.floor(p.y/4)},${Math.floor(p.z/4)}:${fluidRevision}`
    const cached=fluids.get(name)
    if(cached?.signature===signature&&cached.until>Date.now()&&(!cached.value||source(bot.blockAt(cached.value.position),name)&&safeStand(cached.value.stand)))return cached.value
    const positions=bot.findBlocks({matching:b=>source(b,name),maxDistance:48,count:48,useExtraInfo:b=>!protectedBase?.(b.position)})
    positions.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position))
    for(const p of positions.slice(0,12)){
      if(protectedBase?.(p)||!source(bot.blockAt(p),name))continue
      const stand=bank(p)
      if(stand){const value={position:p,stand};fluids.set(name,{signature,until:Date.now()+1500,value});return value}
    }
    fluids.set(name,{signature,until:Date.now()+1500,value:null})
    return null
  }
  function offer(){
    if(!['overworld','minecraft:overworld'].includes(bot.game.dimension))return null
    const water=count('water_bucket')?true:findFluid('water')
    const lava=count('lava_bucket')?true:findFluid('lava')
    if(!water||!lava)return null
    return {id:'obsidian:create',kind:'create_obsidian',blocks:1,resource:'obsidian',safe:true,
      water_source:water===true?'bucket':xyz(water.position),lava_source:lava===true?'bucket':xyz(lava.position),
      needs_buckets:Math.max(0,2-count('bucket')-count('water_bucket')-count('lava_bucket')),reason:'no_safe_natural_route'}
  }
  const active=()=>ui.obsidianFactory?.dimension===bot.game.dimension&&ui.obsidianFactory.enabled===true
  function select(){
    healthy()
    if(!usablePick())throw new Error('Нет подходящей исправной кирки: обсидиан требует алмазную или незеритовую.')
    if(!offer())throw new Error('Для создания обсидиана нет доступных источников лавы и воды.')
    ui.obsidianFactory={dimension:bot.game.dimension,enabled:true,phase:'prepare',created:0}
  }
  async function waitFor(check,ticks=60){
    for(let tick=0;tick<ticks;tick++){
      healthy()
      if(check())return
      await bot.waitForTicks(1)
    }
    throw new Error('Сервер не подтвердил действие с ведром или обсидианом.')
  }
  async function useBucket(name,point,check,reference){
    healthy()
    const eye=bot.entity.position.offset(0,bot.entity.eyeHeight||1.62,0)
    if(eye.distanceTo(point)>4.5)throw new Error('Ведро: блок вне досягаемости.')
    if(reference){
      const hit=bot.world.raycast(eye,point.minus(eye).normalize(),eye.distanceTo(point)+.1)
      if(!hit?.position.equals(reference))throw new Error('Ведро: нужная грань закрыта; жидкость не выливается.')
    }
    await equip(name)
    await bot.lookAt(point)
    await bot.waitForTicks(1)
    healthy()
    if(reference&&Number.isFinite(bot.entity.yaw)&&Number.isFinite(bot.entity.pitch)){
      const yaw=bot.entity.yaw,pitch=bot.entity.pitch
      const direction=new Vec3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch))
      const hit=bot.world.raycast(bot.entity.position.offset(0,bot.entity.eyeHeight||1.62,0),direction,4.5)
      if(!hit?.position.equals(reference))throw new Error('Ведро: серверный прицел не совпал с формой; выливание отменено.')
    }
    bot.activateItem()
    await waitFor(check)
    bot.usingHeldItem=false
  }
  async function move(p){
    healthy()
    await limited(bot.pathfinder.goto(new goals.GoalBlock(p.x,p.y,p.z)),15000)
    await require('./center-position')(bot)
    healthy()
    if(bot.entity.position.distanceTo(p.offset(.5,0,.5))>1.5)throw new Error('Безопасная площадка для ведра недоступна.')
  }
  async function fill(name){
    if(count(`${name}_bucket`))return
    if(!count('bucket'))throw new Error('Недостаточно материалов: нужно пустое ведро для '+name+'.')
    const fluid=findFluid(name)
    if(!fluid)throw new Error(`Создание обсидиана: нужен доступный источник ${name==='lava'?'лавы':'воды'} в загруженных чанках.`)
    await move(fluid.stand)
    if(!source(bot.blockAt(fluid.position),name)||protectedBase?.(fluid.position))throw new Error('Источник жидкости изменился; действие отменено.')
    const before=count(`${name}_bucket`)
    await useBucket('bucket',fluid.position.offset(.5,.5,.5),()=>count(`${name}_bucket`)>before)
  }
  function mold(center){
    const cells=[]
    for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)if(x||z)for(let y=0;y<=1;y++)cells.push(center.offset(x,y,z))
    return cells.concat([center.offset(2,0,0)])
  }
  function validCenter(p){
    if(!p||![p.x,p.y,p.z].every(Number.isInteger)||Math.abs(p.x)>30000000||Math.abs(p.z)>30000000||p.y < -60||p.y>315)return false
    for(let x=-2;x<=3;x++)for(let z=-2;z<=2;z++){
      const cell=p.offset(x,0,z)
      if(protectedBase?.(cell)||!ground(bot.blockAt(cell.offset(0,-1,0))))return false
    }
    return true
  }
  function findCenter(){
    const feet=bot.entity.position.floored(),choices=[]
    for(let x=-16;x<=16;x++)for(let z=-16;z<=16;z++){
      if(Math.hypot(x,z)<3||Math.hypot(x,z)>18)continue
      const p=feet.offset(x,0,z)
      let clear=true
      for(let dx=-2;dx<=3&&clear;dx++)for(let dz=-2;dz<=2&&clear;dz++)for(let y=0;y<=3;y++){
        if(!air(bot.blockAt(p.offset(dx,y,dz)))){clear=false;break}
      }
      if(clear&&validCenter(p)&&safeStand(p.offset(3,0,0)))choices.push(p)
    }
    choices.sort((a,b)=>a.distanceTo(feet)-b.distanceTo(feet))
    return choices.find(p=>route(p.offset(3,0,0)))
  }
  function sealed(center){
    return validCenter(center)&&ground(bot.blockAt(center.offset(0,-1,0)))&&mold(center).every(p=>stone(bot.blockAt(p)))
  }
  async function build(center){
    if(!validCenter(center))throw new Error('Форма обсидиана: основание или защищённая зона изменились.')
    const target=mold(center).find(p=>!stone(bot.blockAt(p)))
    if(!target)return true
    if(!air(bot.blockAt(target)))throw new Error('Форма обсидиана занята чужим блоком.')
    const material=['cobblestone','cobbled_deepslate','stone'].find(name=>count(name))
    if(!material)throw new Error('Недостаточно материалов: для формы обсидиана нужны 17 каменных блоков.')
    const references=[new Vec3(0,-1,0),...sides].map(v=>({block:bot.blockAt(target.plus(v)),face:v.scaled(-1)})).filter(row=>ground(row.block))
    if(!references.length)throw new Error('Форма обсидиана: нет опоры для блока.')
    const reference=references[0]
    await limited(bot.pathfinder.goto(new goals.GoalLookAtBlock(reference.block.position,bot.world,{reach:4})),12000)
    healthy()
    if(!air(bot.blockAt(target))||protectedBase?.(target)||bot.entity.position.floored().equals(target))throw new Error('Форма обсидиана: размещение отменено.')
    await equip(material)
    await limited(bot.placeBlock(reference.block,reference.face),8000)
    await waitFor(()=>stone(bot.blockAt(target)),20)
    ui.obsidianFactory.placed??={}
    ui.obsidianFactory.placed[`${target.x},${target.y},${target.z}`]=material
    return false
  }
  async function step(){
    healthy()
    if(!active())throw new Error('Создание обсидиана не выбрано.')
    const job=ui.obsidianFactory
    if(ui.pendingLoot&&!['open_exit','collect'].includes(job.phase)){await skills.pickup(ui.pendingLoot.wanted);return {phase:job.phase,pending:ui.pendingLoot}}
    let center=job.center&&vector(job.center)
    if(center&&!validCenter(center))throw new Error('Сохранённая форма обсидиана больше небезопасна.')
    if(center){
      const block=bot.blockAt(center),water=bot.blockAt(center.offset(0,1,0))
      if(block?.name==='obsidian'&&/water/.test(water?.name||''))job.phase='recover_water'
      else if(block?.name==='obsidian'&&air(water))job.phase='mine'
      else if(source(block,'lava'))job.phase=source(water,'water')?'cool':'cast_water'
    }
    ui.stage=`Обсидиан из лавы и воды · ${job.phase}`
    if(job.phase==='prepare'){
      const total=()=>count('bucket')+count('water_bucket')+count('lava_bucket')
      if((total()<2||count('cobblestone')+count('cobbled_deepslate')+count('stone')<17)&&ui.home&&bot.entity.position.distanceTo(vector(ui.home))<16){
        await skills.homeWithdraw({bucket:Math.max(0,2-count('water_bucket')-count('lava_bucket')),water_bucket:1,lava_bucket:1,iron_ingot:Math.max(0,2-total())*3,cobblestone:17})
      }
      if(total()<2){
        const missing=2-total()
        if(count('iron_ingot')<missing*3)throw new Error('Недостаточно материалов: нужны два ведра или до 6 железных слитков для создания обсидиана.')
        await skills.craft('bucket',missing)
      }
      job.phase='water'
    }else if(job.phase==='water'){await fill('water');job.phase='lava'}
    else if(job.phase==='lava'){await fill('lava');job.phase='build'}
    else if(job.phase==='build'){
      if(!center){center=findCenter();if(!center)throw new Error('Для формы обсидиана нужна свободная каменная площадка вне базы.');job.center=xyz(center)}
      if(await build(center))job.phase='cast_lava'
    }else if(job.phase==='cast_lava'){
      if(!usablePick())throw new Error('Нет подходящей исправной кирки для отлитого обсидиана.')
      if(!sealed(center)||!air(bot.blockAt(center))||!air(bot.blockAt(center.offset(0,1,0))))throw new Error('Форма не закрыта или не осушена; лава не выливается.')
      await move(center.offset(1,2,0))
      if(!sealed(center))throw new Error('Форма повреждена перед выливанием лавы.')
      if(!count('lava_bucket')){job.phase='lava';return {phase:job.phase}}
      await useBucket('lava_bucket',center.offset(.1,-.001,.5),()=>source(bot.blockAt(center),'lava')&&count('bucket')>0,center.offset(0,-1,0))
      job.phase='cast_water'
    }else if(job.phase==='cast_water'){
      if(!sealed(center)||!source(bot.blockAt(center),'lava'))throw new Error('Лава для обсидиана не является изолированным источником.')
      if(!count('water_bucket'))throw new Error('Нужно ведро воды для охлаждения лавы в форме.')
      await move(center.offset(-1,2,0))
      if(!sealed(center))throw new Error('Форма повреждена перед выливанием воды.')
      const before=count('water_bucket')
      await useBucket('water_bucket',center.offset(1.001,1.5,.5),()=>source(bot.blockAt(center.offset(0,1,0)),'water')&&count('water_bucket')<before,center.offset(1,1,0))
      job.phase='cool'
    }else if(job.phase==='cool'){
      await waitFor(()=>bot.blockAt(center)?.name==='obsidian',100)
      job.phase='recover_water'
    }else if(job.phase==='recover_water'){
      await move(center.offset(1,2,0))
      const water=center.offset(0,1,0)
      if(source(bot.blockAt(water),'water')){
        const before=count('water_bucket')
        await useBucket('bucket',water.offset(.5,.5,.5),()=>count('water_bucket')>before&&!source(bot.blockAt(water),'water'))
      }
      await waitFor(()=>! /water|lava/.test(bot.blockAt(water)?.name||''),100)
      job.phase='mine'
    }else if(job.phase==='mine'){
      if(!sealed(center)||bot.blockAt(center)?.name!=='obsidian'||!air(bot.blockAt(center.offset(0,1,0))))throw new Error('Обсидиан пока не безопасен для добычи.')
      await move(center.offset(1,2,0))
      const block=bot.blockAt(center)
      if(!bot.canDigBlock(block)||!bot.canSeeBlock(block))throw new Error('Отлитый обсидиан недоступен для кирки.')
      skills.remember(['obsidian'],center)
      job.before=count('obsidian')
      await dig(block)
      job.phase='open_exit'
    }else if(job.phase==='open_exit'){
      const gate=center.offset(1,1,0),block=bot.blockAt(gate)
      if(!air(block)){
        if(job.placed?.[`${gate.x},${gate.y},${gate.z}`]!==block?.name)throw new Error('Выход формы изменён; чужой блок не разбирается.')
        await move(center.offset(-1,2,0))
        await dig(block)
      }
      job.phase='collect'
    }else if(job.phase==='collect'){
      await skills.pickup(['obsidian'])
      if(count('obsidian')>(job.before||0)&&!ui.pendingLoot){job.created++;job.phase='lava'}
    }else throw new Error('Неизвестный этап создания обсидиана.')
    return {phase:job.phase,created:job.created}
  }
  function confirmCollection(){
    const job=ui.obsidianFactory
    if(active()&&['collect','open_exit'].includes(job.phase)&&count('obsidian')>(job.before||0)&&!ui.pendingLoot){job.created++;job.phase='lava'}
  }
  async function prepareCollection(){
    if(active()&&ui.obsidianFactory.phase==='open_exit')await step()
  }
  return {offer,active,select,step,findFluid,safeStand,source,sealed,confirmCollection,prepareCollection}
}
