'use strict'
module.exports = bot => {
  let route=[]
  bot.on('path_update',result=>{route=result.path||[]})
  bot.on('physicsTick',()=>{
    const next=route[0],entity=bot.entity
    if(!bot.pathfinder.goal||!next||!entity||entity.isInWater||entity.isInLava||bot.health<=8||bot.targetDigBlock||bot.pathfinder.isMining?.()||bot.pathfinder.isBuilding?.()||next.toBreak?.length||next.toPlace?.length)return
    const feet=entity.position.floored(),target=next.floored()
    if(target.y-feet.y!==1||Math.abs(target.x-feet.x)+Math.abs(target.z-feet.z)!==1||next.y-entity.position.y<.05)return
    const air=p=>['air','cave_air','void_air'].includes(bot.blockAt(p)?.name)
    if(!air(feet.offset(0,2,0))||!air(target)||!air(target.offset(0,1,0))||bot.blockAt(target.offset(0,-1,0))?.boundingBox!=='block')return
    for(const p of [feet,target])for(const offset of [[0,0,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]])
      if(/water|lava|fire|magma_block/.test(bot.blockAt(p.offset(...offset))?.name||''))return
    bot.setControlState('forward',true)
    bot.setControlState('jump',true)
    bot.setControlState('sprint',false)
  })
}
