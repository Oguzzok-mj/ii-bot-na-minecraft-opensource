'use strict'
const fs=require('node:fs'),path=require('node:path')
const {Vec3}=require('vec3')
const {goals}=require('mineflayer-pathfinder')
const FEATURES=['distance','vertical','vein','solid','hard','fluid','unknown','exposed','below','visited','dig_seconds','horizontal']
const offsets=[new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),new Vec3(0,0,1),new Vec3(0,0,-1)]
const key=p=>`${p.x},${p.y},${p.z}`
const danger=b=>!b||/lava|water|fire|magma_block|powder_snow/.test(b.name)
const xyz=p=>({x:p.x,y:p.y,z:p.z})

module.exports=(bot,skills)=>{
  let model=null,lastLoad=0,lastStamp=null,movements=null
  const root=skills.policyDirectory||__dirname,file=path.join(root,'models/miner.json'),data=path.join(root,'data')
  const history=new Map()
  const eligible=p=>{
    const block=bot.blockAt(p)
    return block&&!skills.protectedBase?.(p)&&(skills.blocked?.get(`ore:${key(p)}`)||0)<Date.now()&&!offsets.some(v=>danger(bot.blockAt(p.plus(v))))&&
      !(p.x===bot.entity.position.floored().x&&p.z===bot.entity.position.floored().z&&p.y<bot.entity.position.y)
  }
  function append(name,row){
    try{fs.mkdirSync(data,{recursive:true});fs.appendFileSync(path.join(data,name),JSON.stringify(row)+'\n')}
    catch(error){skills.ui.miningLogError=error.message}
  }
  function load(force=false){
    if(!force&&Date.now()-lastLoad<10000)return
    lastLoad=Date.now()
    try{
      const stat=fs.statSync(file)
      if(!force&&stat.mtimeMs===lastStamp)return
      if(stat.size>1000000)throw new Error('Размер модели превышен')
      const value=JSON.parse(fs.readFileSync(file,'utf8'))
      if(value.schema!==1||JSON.stringify(value.features)!==JSON.stringify(FEATURES)||value.validation?.accepted!==true)throw new Error('Модель не прошла проверку')
      const dimensions=[12,32,16,1]
      if(!Array.isArray(value.mean)||value.mean.length!==12||!value.mean.every(Number.isFinite)||!Array.isArray(value.scale)||value.scale.length!==12||!value.scale.every(x=>Number.isFinite(x)&&x>0))throw new Error('Неверные признаки модели')
      if(value.layers?.length!==3)throw new Error('Неверные слои модели')
      for(let i=0;i<3;i++){
        const layer=value.layers[i]
        if(layer.w?.length!==dimensions[i]||layer.b?.length!==dimensions[i+1]||!layer.b.every(Number.isFinite)||!layer.w.every(row=>row.length===dimensions[i+1]&&row.every(Number.isFinite)))throw new Error('Неверные веса модели')
      }
      model=value;lastStamp=stat.mtimeMs
      skills.ui.miningPolicy={name:'miner-12x32x16',samples:value.samples,trainedAt:value.trainedAt,validation:value.validation,decisions:0}
    }catch(error){
      if(error.code!=='ENOENT')skills.ui.miningModelError=error.message
      model=null;skills.ui.miningPolicy={name:'route-teacher',decisions:0}
    }
  }
  function predict(features){
    if(!model)return null
    let x=features.map((v,i)=>(v-model.mean[i])/model.scale[i])
    if(x.some(v=>!Number.isFinite(v)||Math.abs(v)>8))return null
    for(let i=0;i<model.layers.length;i++){
      const layer=model.layers[i]
      x=layer.b.map((b,j)=>b+x.reduce((sum,v,k)=>sum+v*layer.w[k][j],0))
      if(i<2)x=x.map(Math.tanh)
    }
    return Number.isFinite(x[0])?x[0]:null
  }
  function describe(positions,variants,origin=bot.entity.position){
    const names=new Set(variants),pending=new Map(positions.filter(p=>names.has(bot.blockAt(p)?.name)&&eligible(p)).map(p=>[key(p),p])),groups=[]
    while(pending.size){
      const seed=pending.values().next().value,queue=[seed],blocks=[]
      pending.delete(key(seed))
      for(let i=0;i<queue.length&&blocks.length<64;i++){
        const p=queue[i];blocks.push(p)
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
          if(!x&&!y&&!z)continue
          const p2=p.offset(x,y,z),pkey=key(p2)
          if(pending.has(pkey)){queue.push(pending.get(pkey));pending.delete(pkey)}
        }
      }
      blocks.sort((a,b)=>a.distanceTo(origin)-b.distanceTo(origin))
      const position=blocks[0],distance=position.distanceTo(origin),line=position.offset(.5,.5,.5).minus(origin.offset(0,1,0))
      let solid=0,hard=0,fluid=0,unknown=0
      const samples=Math.max(1,Math.ceil(line.norm()))
      for(let i=1;i<=samples;i++){
        const b=bot.blockAt(origin.offset(0,1,0).plus(line.scaled(i/samples)).floored())
        if(!b)unknown++
        else{if(b.boundingBox==='block')solid++;if(b.hardness>=3)hard++;if(/water|lava/.test(b.name))fluid++}
      }
      const exposed=blocks.reduce((sum,p)=>sum+offsets.filter(v=>['air','cave_air'].includes(bot.blockAt(p.plus(v))?.name)).length,0)/(blocks.length*6)
      const block=bot.blockAt(position)
      let digSeconds=.5
      try{digSeconds=Math.min(12,Math.max(.05,(bot.digTime?.(block)||500)/1000))}catch(error){}
      const features=[distance/64,Math.abs(position.y-origin.y)/64,Math.log1p(blocks.length)/Math.log(65),solid/samples,hard/samples,fluid/samples,unknown/samples,exposed,Number(position.y<origin.y),Math.min(1,(history.get(key(position))||0)/4),digSeconds/12,Math.hypot(position.x-origin.x,position.z-origin.z)/64]
      const seconds=1+distance*.45+solid*digSeconds*1.8+Math.abs(position.y-origin.y)*.4+fluid*10+unknown*4+blocks.length*digSeconds
      groups.push({id:`${bot.game?.dimension}:${blocks.map(key).sort()[0]}`,position,blocks,features,teacher:Math.log(blocks.length/seconds),seconds})
    }
    return groups.sort((a,b)=>b.teacher-a.teacher)
  }
  function positions(variants){
    const names=new Set(variants)
    if(skills.radar.scan){
      const indexed=skills.radar.scan().filter(row=>names.has(row.name)&&names.has(bot.blockAt(row.position)?.name)).map(row=>row.position)
      if(indexed.length)return indexed
    }
    return bot.findBlocks({matching:b=>b&&names.has(b.name),maxDistance:64,count:512,useExtraInfo:b=>eligible(b.position)})
  }
  function candidates(variants){
    load()
    const candidates=describe(positions(variants),variants)
    for(const candidate of candidates)candidate.score=predict(candidate.features)??candidate.teacher
    candidates.sort((a,b)=>b.score-a.score)
    return candidates
  }
  function select(variants){
    const ranked=candidates(variants)
    const selected=ranked[0]
    if(selected){
      history.set(key(selected.position),(history.get(key(selected.position))||0)+1)
      if(history.size>4096)history.delete(history.keys().next().value)
      skills.ui.miningPolicy.decisions++
      selected.neural=Boolean(model&&predict(selected.features)!==null)
    }
    return selected
  }
  function probe(candidate,origin){
    if(!movements&&bot.registry.blocksArray)movements=require('./navigation')(bot,{returning:true,protectedBase:skills.protectedBase,home:skills.ui.home})
    let status='unavailable',cost=candidate.seconds
    if(movements&&bot.pathfinder.getPathFromTo){
      try{
        const result=bot.pathfinder.getPathFromTo(movements,origin,new goals.GoalNear(candidate.position.x,candidate.position.y,candidate.position.z,3),{timeout:35,tickTimeout:35,optimizePath:false}).next().value.result
        status=result.status
        if(result.path.length||status==='success'){
          const length=result.path.reduce((sum,node,i)=>sum+(i?Math.hypot(node.x-result.path[i-1].x,node.y-result.path[i-1].y,node.z-result.path[i-1].z):0),0)
          const breaks=result.path.reduce((sum,node)=>sum+(node.toBreak?.length||0),0)
          const tail=result.path[result.path.length-1]||origin
          const remaining=status==='success'?0:Math.max(0,candidate.position.distanceTo(new Vec3(tail.x,tail.y,tail.z))-3)
          cost=1+length*.4+breaks*(candidate.features[10]*12+.2)+remaining*(.5+candidate.features[3]*candidate.features[10]*24)+candidate.blocks.length*candidate.features[10]*12
          if(status==='noPath')cost*=2
        }else cost*=1.4
      }catch(error){status='error';cost*=1.6}
    }
    return {routeStatus:status,seconds:cost,score:Math.log(candidate.blocks.length/Math.max(1,cost))}
  }
  async function capture(request={}){
    const deadline=Date.now()+5000
    while(skills.radar.snapshot?.().scanPending>0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20))
    const variants=['diamond_ore','deepslate_diamond_ore'],ores=skills.radar.orePositions?.(variants,160)||positions(variants),origins=[bot.entity.position.clone()],seen=new Set([key(origins[0].floored())])
    const saved=skills.ui.miningTrail?.[bot.game.dimension]||[]
    const stride=Math.max(1,Math.floor(saved.length/160))
    for(let i=0;i<saved.length;i+=stride){
      const v=saved[i],p=new Vec3(v.x+.5,v.y,v.z+.5),k=key(p.floored())
      if(seen.has(k)||Math.abs(p.y-bot.entity.position.y)>128||Math.hypot(p.x-bot.entity.position.x,p.z-bot.entity.position.z)>80)continue
      const feet=bot.blockAt(p.floored()),head=bot.blockAt(p.floored().offset(0,1,0)),floor=bot.blockAt(p.floored().offset(0,-1,0))
      if(!feet||!head||feet.boundingBox==='block'||head.boundingBox==='block'||floor?.boundingBox!=='block'||danger(feet)||danger(head))continue
      seen.add(k);origins.push(p)
    }
    const offset=Math.max(0,Math.min(10000,Number(request.offset)||0)),batch=origins.slice(offset,offset+Math.min(12,Math.max(1,Number(request.batch)||8)))
    let samples=0,statuses={}
    for(const origin of batch){
      const candidates=describe(ores,variants,origin).filter(c=>c.position.distanceTo(origin)<=80).slice(0,24)
      const query=`${bot.game.dimension}:${key(origin.floored())}`
      for(const c of candidates){
        const route=probe(c,origin)
        append('mining-training.jsonl',{schema:1,source:'minecraft_world_route_teacher',dimension:bot.game.dimension,query,vein:c.id,origin:xyz(origin),position:xyz(c.position),features:c.features,score:route.score,routeStatus:route.routeStatus,seconds:route.seconds,veinSize:c.blocks.length,actualOrigin:origin.distanceTo(bot.entity.position)<1,capturedAt:new Date().toISOString()})
        statuses[route.routeStatus]=(statuses[route.routeStatus]||0)+1;samples++
      }
      await new Promise(resolve=>setImmediate(resolve))
    }
    return {samples,statuses,origins:origins.length,next:offset+batch.length,done:offset+batch.length>=origins.length,model:skills.ui.miningPolicy}
  }
  function outcome(target,seconds,collected,error){
    if(!target?.candidate||!bot._client||!bot.username)return
    append('mining-outcomes.jsonl',{schema:1,source:'minecraft_play',vein:target.candidate.id,features:target.candidate.features,position:xyz(target.position),seconds,collected,ok:collected>0&&!error,error:error||null,neural:target.candidate.neural,at:new Date().toISOString()})
  }
  load(true)
  return {select,candidates,capture,outcome,predict,describe,reload:()=>load(true),FEATURES}
}
module.exports.FEATURES=FEATURES
