const assert=require('node:assert/strict')
const path=require('node:path')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const {EventEmitter}=require('node:events')
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Chunk=require(path.join(root,'node_modules/prismarine-chunk'))('1.20.1')
const bot=new EventEmitter()
bot.registry=registry;bot.entity={position:new Vec3(0,0,0),yaw:0,pitch:0};bot.username='Test'
bot.players={Test:{entity:bot.entity},Human:{entity:{position:new Vec3(2,0,0)}}}
bot.findBlocks=()=>[]
const radar=require(path.join(root,'radar'))(bot)
const chunk=new Chunk()
const diamond=new Vec3(1,-20,1),stone=new Vec3(2,-20,1),copper=new Vec3(3,-20,1),ancient=new Vec3(4,-20,1)
for(const [pos,name] of [[diamond,'deepslate_diamond_ore'],[stone,'stone'],[copper,'copper_ore'],[ancient,'ancient_debris']])chunk.setBlockStateId(pos,registry.blocksByName[name].minStateId)
const filtered=radar.filtered(chunk)
assert.equal(filtered.getBlockStateId(stone),0)
for(const pos of [diamond,copper,ancient])assert.equal(filtered.getBlockStateId(pos),chunk.getBlockStateId(pos))
assert.notEqual(chunk.getBlockStateId(stone),0)
assert.equal(radar.playerList()[0].name,'Human')
delete bot.players.Human.entity
assert.equal(radar.playerList()[0].live,false)
assert.equal(radar.playerList()[0].position.x,2)
console.log('PASS: ore-only chunks, deep ores, copper, ancient debris, original world unchanged, remembered player ESP')
