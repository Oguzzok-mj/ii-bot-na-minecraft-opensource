'use strict'
module.exports = bot => async (operation, milliseconds) => {
  let timer
  try {
    return await Promise.race([operation,new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Действие заняло слишком долго.')),milliseconds)
    })])
  } catch (error) {
    bot.pathfinder.setGoal(null)
    bot.clearControlStates()
    throw error
  } finally { clearTimeout(timer) }
}
