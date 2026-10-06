'use strict'
const {Vec3}=require('vec3')
module.exports=(bot,home)=>{
  const exits=[]
  for(const radius of [16,20,24])for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
    const length=Math.hypot(dx,dz)
    const x=Math.round(home.x+dx/length*radius),z=Math.round(home.z+dz/length*radius)
    for(let y=home.y+12;y>=home.y-8;y--){
      const p=new Vec3(x,y,z),floor=bot.blockAt(p.offset(0,-1,0))
      if(floor?.boundingBox!=='block'||/lava|water|fire|magma_block/.test(floor.name)||!['air','cave_air','void_air'].includes(bot.blockAt(p)?.name)||!['air','cave_air','void_air'].includes(bot.blockAt(p.offset(0,1,0))?.name))continue
      if([[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(o=>/lava|water|fire|magma_block/.test(bot.blockAt(p.offset(...o))?.name||'')))continue
      exits.push(p);break
    }
  }
  return exits.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position)).slice(0,16)
}
