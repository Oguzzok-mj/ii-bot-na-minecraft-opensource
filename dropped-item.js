'use strict'
module.exports = entity => {
  if (!entity || !['item', 'Item', 'item_stack'].includes(entity.name)) return null
  try { return entity.getDroppedItem?.() || null }
  catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}
