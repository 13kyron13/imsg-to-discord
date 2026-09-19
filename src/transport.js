class MessageTransport {
  async start(_onMessage) { throw new Error('MessageTransport.start() is not implemented'); }
  async sendText(_chatId, _text) { throw new Error('MessageTransport.sendText() is not implemented'); }
  status() { return { backend: 'unknown', connected: false, details: 'No status implementation.' }; }
  async close() {}
}

function normalizeMessage(message) {
  return {
    id: String(message.id),
    chatId: message.chatId == null ? null : String(message.chatId),
    sender: message.sender == null ? null : String(message.sender),
    chatName: message.chatName == null ? null : String(message.chatName),
    isGroup: Boolean(message.isGroup),
    text: typeof message.text === 'string' ? message.text : '',
    attachments: Array.isArray(message.attachments) ? message.attachments.filter(a => a && a.path).map(a => ({
      path: String(a.path),
      name: a.name ? String(a.name) : String(a.path).split(/[\\/]/).pop(),
      mimeType: a.mimeType == null ? null : String(a.mimeType)
    })) : []
  };
}

module.exports = { MessageTransport, normalizeMessage };
