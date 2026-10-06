'use strict'
const express = require('express')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const droppedItem = require('./dropped-item')
const { Vec3 } = require('vec3')
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView')
const { setupRoutes } = require('prismarine-viewer/lib/common')

module.exports = async (bot, snapshot, port = 3007, radar, enqueue) => {
  const app = express()
  const session = require('node:crypto').randomUUID()
  let xray = false
  let filtered = new WeakMap()
  const views = new Set()
  const loop='!function t(){window.requestAnimationFrame(t),h&&h.update(),u.update(),l.render(u.scene,u.camera)}()'
  const original=fs.readFileSync(path.join(path.dirname(require.resolve('prismarine-viewer')),'public','index.js'),'utf8')
  if(!original.includes(loop))throw new Error('Не найден цикл отрисовки просмотрщика.')
  const heightLoop='for(let i=0;i<256;i+=16)'
  const addColumn='addColumn(t,e,i){this.loadedChunks'
  if(original.split(heightLoop).length!==3||!original.includes(addColumn))throw new Error('Не найден диапазон высот просмотрщика.')
  const bundle=original.replace(loop,'window.startMineFrames({viewer:u,renderer:l,controls:()=>h})')
    .replace('{path:window.location.pathname+"socket.io"}','{path:"/socket.io"}')
    .replace('resetWorld(){this.active=!1','resetWorld(){this.columnBounds={};this.active=!1')
    .replace(addColumn,'addColumn(t,e,i){const bounds=JSON.parse(i);this.columnBounds??={};this.columnBounds[`${t},${e}`]={minY:bounds.minY??0,height:bounds.worldHeight??256};this.loadedChunks')
    .replaceAll(heightLoop,'for(let i=this.columnBounds?.[`${t},${e}`]?.minY??0;i<(this.columnBounds?.[`${t},${e}`]?.minY??0)+(this.columnBounds?.[`${t},${e}`]?.height??256);i+=16)')
    .replace('delete this.sectionMeshs[n]}}setBlockStateId','delete this.sectionMeshs[n]}delete this.columnBounds?.[`${t},${e}`]}setBlockStateId')
  const rawWorker=fs.readFileSync(path.join(path.dirname(require.resolve('prismarine-viewer')),'public','worker.js'),'utf8')
  if(!rawWorker.includes('i.sections[Math.floor(a/16)]')||!rawWorker.includes('l.sections[Math.floor(n/16)]'))throw new Error('Не найден индекс секции просмотрщика.')
  const worker=rawWorker.replace('i.sections[Math.floor(a/16)]','i.sections[Math.floor((a-(i.minY??0))/16)]')
    .replace('l.sections[Math.floor(n/16)]','l.sections[Math.floor((n-(l.minY??0))/16)]')
    .replace('if(g.position.y<0)continue;','')
    .replace('if(n.position.y<0)continue','')
  app.use(express.json({limit:'2kb'}))
  app.get('/index.js',(request,response)=>response.type('js').send(bundle))
  app.get('/worker.js',(request,response)=>response.type('js').send(worker))
  app.get('/framerate.js',(request,response)=>response.sendFile(path.join(__dirname,'framerate.js')))
  app.get('/esp.js',(request,response)=>response.sendFile(path.join(__dirname,'esp.js')))
  app.get('/items.js',(request,response)=>response.sendFile(path.join(__dirname,'items.js')))
  app.get('/inventory-view.js',(request,response)=>response.sendFile(path.join(__dirname,'inventory-view.js')))
  app.get('/api/item-texture/:name',(request,response)=>{
    const name=request.params.name
    if(!/^[a-z0-9_]+$/.test(name))return response.sendStatus(400)
    const textures=path.join(path.dirname(require.resolve('prismarine-viewer')),'public','textures',bot.version)
    const file=['items','blocks'].map(folder=>path.join(textures,folder,name+'.png')).find(file=>fs.existsSync(file))
    if(!file)return response.sendStatus(404)
    response.sendFile(file)
  })
  app.get('/', (request, response) => response.sendFile(path.join(__dirname, 'observer.html')))
  app.get('/scene', (request, response) => response.sendFile(path.join(__dirname, 'scene.html')))
  app.get('/api/state', (request, response) => {
    response.set('Cache-Control', 'no-store')
    const value={...snapshot(),xray}
    value.oreRevision=`${session}:${value.oreRevision}`
    if(String(value.oreRevision)===request.query.oreRevision)delete value.ores
    response.json(value)
  })
  app.post('/api/control', async (request,response) => {
    if(request.headers.origin && request.headers.origin!==`http://${request.headers.host}`)return response.sendStatus(403)
    if(request.body.command==='xray'){
      xray=Boolean(request.body.enabled)
      try{
        for(const view of views)for(const coordinates of Object.keys(view.loadedChunks)){
          const [x,z]=coordinates.split(',').map(Number)
          await view.loadChunk(new Vec3(x,0,z))
        }
        response.json({ok:true,xray})
      }catch(error){response.status(500).json({error:error.message})}
    }else if(request.body.command==='pause'){
      enqueue({command:'pause',enabled:Boolean(request.body.enabled)})
      response.json({ok:true,paused:Boolean(request.body.enabled)})
    }else if(request.body.command==='deposit'){
      enqueue({command:'deposit',player:String(request.body.player||'').slice(0,32)})
      response.json({ok:true})
    }else response.sendStatus(400)
  })
  setupRoutes(app)
  const server = http.createServer(app)
  const io = require('socket.io')(server)
  const changed=(oldBlock,newBlock)=>{
    const p=newBlock?.position||oldBlock?.position
    if(!p)return
    const column=bot.world.getColumn(Math.floor(p.x/16),Math.floor(p.z/16))
    if(column)filtered.delete(column)
  }
  bot.on('blockUpdate',changed)
  const loaded=position=>changed(null,{position})
  bot.on('chunkColumnLoad',loaded)
  io.on('connection', socket => {
    socket.emit('version', bot.version)
    const world=new Proxy(bot.world,{get(target,property){
      if(property==='getColumnAt')return async position=>{
        const column=await target.getColumnAt(position)
        if(!column||!xray)return column
        if(!filtered.has(column))filtered.set(column,radar.filtered(column))
        return filtered.get(column)
      }
      const value=Reflect.get(target,property)
      return typeof value==='function'?value.bind(target):value
    }})
    const emitter={on:(...args)=>socket.on(...args),emit:(name,value)=>{
      if(name==='blockUpdate'&&xray&&!radar.oreStates.has(value.stateId))value={...value,stateId:0}
      if(name==='entity'&&!value.delete){const item=droppedItem(bot.entities[value.id]);if(item)value={...value,itemName:item.name}}
      socket.emit(name,value)
    }}
    const view = new WorldView(world, 4, bot.entity.position, emitter)
    views.add(view)
    let updating=false
    const position = () => {
      socket.emit('position', {pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, addMesh: false})
      if(!updating){updating=true;view.updatePosition(bot.entity.position).catch(error=>console.error(error.message)).finally(()=>{updating=false})}
    }
    bot.on('move', position)
    const unload=point=>view.unloadChunk(point)
    bot.on('chunkColumnUnload',unload)
    view.listenToBot(bot)
    view.init(bot.entity.position).then(position).catch(error => console.error(error.message))
    socket.on('disconnect', () => {
      bot.removeListener('move', position)
      bot.removeListener('chunkColumnUnload',unload)
      views.delete(view)
      view.removeListenersFromBot(bot)
    })
  })
  await new Promise((resolve, reject) => {
    const failure = error => {
      if (error.code === 'EADDRINUSE') server.listen(0, '127.0.0.1')
      else reject(error)
    }
    server.on('error', failure)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', failure)
      resolve()
    })
  })
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => {bot.removeListener('blockUpdate',changed);bot.removeListener('chunkColumnLoad',loaded);io.close()} }
}
