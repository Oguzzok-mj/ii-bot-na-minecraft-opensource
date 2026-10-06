'use strict'
const {Vec3}=require('vec3')
const {goals}=require('mineflayer-pathfinder')

module.exports=(bot,{limited,ui})=>{
  const safe=p=>{
    const feet=bot.blockAt(p),head=bot.blockAt(p.offset(0,1,0)),floor=bot.blockAt(p.offset(0,-1,0))
    return feet&&head&&feet.boundingBox!=='block'&&head.boundingBox!=='block'&&floor?.boundingBox==='block'&&
      ![[0,0,0],[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(o=>/lava|water|fire|magma_block/.test(bot.blockAt(p.offset(...o))?.name||''))
  }
  async function follow(points,reverse=false){
    if(!points?.length||!bot.pathfinder.getPathFromTo)return false
    const values=[]
    for(const p of points.filter(p=>[p.x,p.y,p.z].every(Number.isFinite))){
      const v=new Vec3(p.x,p.y,p.z),previous=values.findIndex(item=>item.equals(v))
      if(previous>=0)values.splice(previous+1)
      else values.push(v)
    }
    if(!values.length)return false
    const nearest=values.reduce((best,p,i)=>p.distanceTo(bot.entity.position)<values[best].distanceTo(bot.entity.position)?i:best,0)
    const ordered=reverse?values.slice(0,nearest+1).reverse():values.slice(nearest)
    if(ordered[0].distanceTo(bot.entity.position)>32)return false
    const deadline=Date.now()+75000
    for(let index=0;index<ordered.length;){
      if(bot.health<=8||bot.entity.isInLava)throw new Error('Маршрут остановлен: здоровье или лава.')
      if(Date.now()>deadline)return false
      if(ordered[index].distanceTo(bot.entity.position)<1){index++;continue}
      let chosen=null
      for(let next=Math.min(index+12,ordered.length-1);next>=index;next--){
        const p=ordered[next]
        if(!safe(p))continue
        const goal=new goals.GoalBlock(p.x,p.y,p.z)
        const budget=index===0?150:30
        const probe=bot.pathfinder.getPathFromTo(bot.pathfinder.movements,bot.entity.position,goal,{timeout:budget,tickTimeout:budget}).next().value.result
        if(probe.status==='success'){chosen={next,p,goal};break}
      }
      if(!chosen)return false
      ui.stage=reverse?'Возвращаюсь по готовой шахте':'Возвращаюсь к месту добычи'
      try{await limited(bot.pathfinder.goto(chosen.goal),6000)}catch(error){return false}
      if(bot.entity.position.distanceTo(chosen.p)>1.6)return false
      index=chosen.next+1
    }
    return true
  }
  return {follow}
}
