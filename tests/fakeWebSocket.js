"use strict";

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = {
      close: [],
      error: [],
      message: [],
      open: []
    };
    this.closed = false;
  }

  addEventListener(eventName, handler) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(handler);
  }

  emit(eventName, payload = {}) {
    for (const handler of this.listeners[eventName] || []) {
      handler(payload);
    }
  }

  send() {}

  close(code = 1000, reason = "normal_closure") {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", { code, reason });
  }
}

module.exports = {
  FakeWebSocket
};
