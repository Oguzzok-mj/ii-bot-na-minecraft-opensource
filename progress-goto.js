'use strict'
module.exports=(bot,limited)=>async(goal,total=30000,stall=8000)=>{
  let position=bot.entity.position.clone(),last=Date.now(),timer
  const moved=()=>{last=Date.now();position=bot.entity.position.clone()}
  bot.on?.('diggingCompleted',moved)
  try{
    const stopped=new Promise((resolve,reject)=>{
      timer=setInterval(()=>{
        if(bot.entity.position.distanceTo(position)>.35)moved()
        if(Date.now()-last>stall)reject(new Error('Маршрут не продвигается; выбираю другой выход.'))
      },250)
      timer.unref?.()
    })
    return await limited(Promise.race([bot.pathfinder.goto(goal),stopped]),total)
  }finally{clearInterval(timer);bot.removeListener?.('diggingCompleted',moved)}
}
