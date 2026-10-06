'use strict'
const { Vec3 } = require('vec3')
const isOre = name => /_ore$/.test(name || '') || name === 'ancient_debris'
const isHazard = name => name === 'lava' || name === 'flowing_lava'

module.exports = bot => {
  const oreStates = new Set(Object.values(bot.registry.blocksByName).filter(b=>isOre(b.name))
    .flatMap(b=>Array.from({length:b.maxStateId-b.minStateId+1},(_,i)=>b.minStateId+i)))
  const hazardStates = new Set(Object.values(bot.registry.blocksByName).filter(b=>isHazard(b.name))
    .flatMap(b=>Array.from({length:b.maxStateId-b.minStateId+1},(_,i)=>b.minStateId+i)))
  const players = new Map()
  let cached = [], updated = 0, revision = 0
  const columns = new Map(), jobs = []
  let scheduled = false, location = ''
  const indexed = Boolean(bot.world?.getColumns)
  const stateNames = new Map()
  for(const b of Object.values(bot.registry.blocksByName).filter(b=>isOre(b.name)||isHazard(b.name)))
    for(let id=b.minStateId;id<=b.maxStateId;id++)stateNames.set(id,b.name)
  const columnKey = p => `${Math.floor(p.x/16)},${Math.floor(p.z/16)}`
  const positionKey = p => `${p.x},${p.y},${p.z}`
  function indexColumn(p,column){
    const key=columnKey(p), entries=new Map()
    columns.set(key,entries)
    column.sections.forEach((section,index)=>jobs.push({key,column,section,index,entries,x:Math.floor(p.x/16)*16,z:Math.floor(p.z/16)*16}))
    if(!scheduled){scheduled=true;setImmediate(drain)}
  }
  function drain(){
    const deadline=performance.now()+6
    while(jobs.length && performance.now()<deadline){
      const job=jobs.shift()
      if(columns.get(job.key)!==job.entries)continue
      const {section}=job
      if(!section)continue
      const palette=section.data.palette || (section.data.value!==undefined?[section.data.value]:null)
      if(palette && !palette.some(id=>oreStates.has(id)||hazardStates.has(id)))continue
      const cursor=new Vec3(0,0,0)
      for(cursor.y=0;cursor.y<16;cursor.y++)for(cursor.z=0;cursor.z<16;cursor.z++)for(cursor.x=0;cursor.x<16;cursor.x++){
        const name=stateNames.get(section.get(cursor))
        if(name){
          if(isHazard(name) && ((cursor.x+cursor.z)%2 || cursor.y<15&&hazardStates.has(section.get(cursor.offset(0,1,0)))))continue
          const position=new Vec3(job.x+cursor.x,(job.column.minY??bot.game.minY)+job.index*16+cursor.y,job.z+cursor.z)
          job.entries.set(positionKey(position),{name,position})
        }
      }
      updated=0
    }
    scheduled=jobs.length>0
    if(scheduled)setImmediate(drain)
  }
  if(indexed){
    for(const {chunkX,chunkZ,column} of bot.world.getColumns())indexColumn(new Vec3(Number(chunkX)*16,0,Number(chunkZ)*16),column)
    bot.on('chunkColumnLoad',p=>{const column=bot.world.getColumn(Math.floor(p.x/16),Math.floor(p.z/16));if(column)indexColumn(p,column);updated=0})
    bot.on('chunkColumnUnload',p=>{columns.delete(columnKey(p));updated=0})
  }
  let target = null
  function playerList () {
    for (const [name,player] of Object.entries(bot.players)) {
      if(name===bot.username)continue
      if(player.entity?.position)players.set(name,{name,position:player.entity.position.clone(),seen:Date.now()})
    }
    return [...players.values()].filter(p=>bot.players[p.name]).map(p=>({...p,live:Boolean(bot.players[p.name]?.entity),distance:bot.entity.position.distanceTo(p.position)}))
  }
  function scan (force=false) {
    const p=bot.entity.position, cell=`${Math.floor(p.x/2)},${Math.floor(p.y/2)},${Math.floor(p.z/2)}`
    if(!force && cell===location && Date.now()-updated<2500)return cached
    location=cell
    updated=Date.now()
    if(indexed){
      const groups=new Map()
      for(const [coordinates,entries] of columns){
      const [cx,cz]=coordinates.split(',').map(Number)
      if(Math.abs(cx-Math.floor(p.x/16))>5||Math.abs(cz-Math.floor(p.z/16))>5)continue
      for(const ore of entries.values()){
        const distance=ore.position.distanceTo(p)
        if(distance>(isHazard(ore.name)?24:64))continue
        const kind=ore.name.replace(/^deepslate_|^nether_/,'').replace(/_ore$/,'')
        if(!groups.has(kind))groups.set(kind,[])
        groups.get(kind).push({...ore,distance})
      }
      }
      cached=[...groups.values()].flatMap(group=>group.sort((a,b)=>a.distance-b.distance).slice(0,isHazard(group[0]?.name)?80:160))
    }else{
      const positions=['coal','copper','iron','gold','redstone','lapis','diamond','emerald','quartz','ancient_debris','lava'].flatMap(type=>
        bot.findBlocks({matching:b=>b&&(isOre(b.name)||isHazard(b.name))&&b.name.replace(/^deepslate_|^nether_/,'').replace(/_ore$/,'')===type,maxDistance:type==='lava'?24:64,count:type==='lava'?80:160}))
      cached=positions.map(p=>({name:bot.blockAt(p).name,position:p,distance:p.distanceTo(bot.entity.position)}))
    }
    revision++
    return cached
  }
  function snapshot () {
    return {ores:scan(),oreRevision:revision,scanPending:jobs.length,players:playerList(),target,yaw:bot.entity.yaw,pitch:bot.entity.pitch,scanRadius:64}
  }
  function filtered (column) {
    const Chunk=column.constructor, copy=new Chunk({minY:column.minY,worldHeight:column.worldHeight})
    for(const property of ['biomes','skyLightMask','emptySkyLightMask','skyLightSections','blockLightMask','emptyBlockLightMask','blockLightSections'])if(column[property])copy[property]=column[property]
    if(!copy.sections)throw new Error('X-ray не поддерживает этот формат чанков.')
    const Empty=Chunk.section
    copy.sections=column.sections.map(section=>{
      const palette=section.data.palette || (section.data.value!==undefined?[section.data.value]:null)
      if(palette && !palette.some(id=>oreStates.has(id)))return new Empty({singleValue:0})
      const result=new Empty({singleValue:0})
      for(let y=0;y<16;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
        const p=new Vec3(x,y,z), id=section.get(p)
        if(oreStates.has(id))result.set(p,id)
      }
      return result
    })
    copy.blockEntities={}
    return copy
  }
  bot.on('blockUpdate',(oldBlock,newBlock)=>{
    if(!isOre(oldBlock?.name)&&!isOre(newBlock?.name)&&!isHazard(oldBlock?.name)&&!isHazard(newBlock?.name))return
    const p=newBlock?.position||oldBlock?.position, entries=p&&columns.get(columnKey(p))
    if(entries){if(isOre(newBlock?.name)||isHazard(newBlock?.name))entries.set(positionKey(p),{name:newBlock.name,position:p.clone()});else entries.delete(positionKey(p))}
    updated=0
  })
  bot.on('entityMoved',entity=>{if(entity.username&&entity.username!==bot.username)players.set(entity.username,{name:entity.username,position:entity.position.clone(),seen:Date.now()})})
  function orePositions(names,radius=64){
    const accepted=new Set(names),p=bot.entity.position,found=[]
    for(const entries of columns.values())for(const ore of entries.values())
      if(accepted.has(ore.name)&&ore.position.distanceTo(p)<=radius)found.push(ore.position)
    return found.sort((a,b)=>a.distanceTo(p)-b.distanceTo(p)).slice(0,2048)
  }
  return {snapshot,scan,orePositions,playerList,filtered,oreStates,getTarget:()=>target,setTarget:value=>{target=value}}
}
module.exports.isOre=isOre
