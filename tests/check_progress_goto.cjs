const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
const bot=new EventEmitter();bot.entity={position:new Vec3(0,20,0)}
let finished=false,cancelled=false
bot.clearControlStates=()=>{cancelled=true}
bot.pathfinder={setGoal:()=>{cancelled=true},goto:()=>new Promise(()=>{})}
const go=require(path.join(root,'progress-goto'))(bot,require(path.join(root,'with-timeout'))(bot))
;(async()=>{
 await assert.rejects(go({},3000,100),/не продвигается/)
 assert(cancelled);assert.equal(bot.listenerCount('diggingCompleted'),0)
 cancelled=false
 bot.pathfinder.goto=()=>new Promise(resolve=>{
  let n=0;const timer=setInterval(()=>{bot.entity.position.x++;bot.emit('diggingCompleted');if(++n===4){clearInterval(timer);finished=true;resolve()}},100)
 })
 await go({},3000,200)
 assert(finished&&!cancelled);assert.equal(bot.listenerCount('diggingCompleted'),0)
 console.log('PASS: stalled route cancelled promptly, movement and digging keep a live route running, listeners cleaned up')
})().catch(error=>{console.error(error);process.exitCode=1})
