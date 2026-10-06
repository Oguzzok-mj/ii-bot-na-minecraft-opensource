'use strict'
module.exports = async bot => {
  if(!bot.entity||bot.entity.isInWater||bot.entity.isInLava)return
  const cell=bot.entity.position.floored().offset(.5,0,.5)
  if(Math.hypot(bot.entity.position.x-cell.x,bot.entity.position.z-cell.z)<.16&&bot.entity.onGround)return
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
  await bot.waitForTicks(1)
  const feet=bot.entity.position.floored()
  if(!['air','cave_air','void_air'].includes(bot.blockAt(feet)?.name)||!['air','cave_air','void_air'].includes(bot.blockAt(feet.offset(0,1,0))?.name)||bot.blockAt(feet.offset(0,-1,0))?.boundingBox!=='block')return
  const target=feet.offset(.5,0,.5)
  const distance=()=>Math.hypot(bot.entity.position.x-target.x,bot.entity.position.z-target.z)
  if(distance()<.08)return
  try{
    await bot.lookAt(target.offset(0,bot.entity.eyeHeight||1.62,0),true)
    bot.setControlState('forward',true)
    for(let tick=0;tick<20&&distance()>.08;tick++){
      if(bot.entity.isInLava||Math.abs(bot.entity.position.y-feet.y)>1)break
      await bot.waitForTicks(1)
    }
  }finally{bot.clearControlStates()}
}
