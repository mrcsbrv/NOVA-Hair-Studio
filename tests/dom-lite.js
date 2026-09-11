/* DOM de prueba mínimo para JavaScriptCore, sin dependencias ni navegador.
 * Ejecuta los controladores reales de la app; no pretende medir layout ni CSS.
 */
(function (global) {
  "use strict";
  const voidTags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
  const decode = text => String(text).replace(/&(?:amp|lt|gt|quot|#39|apos);/g, entity => ({
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'"
  }[entity]));

  class LiteEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
      this.defaultPrevented = false;
      Object.assign(this, options);
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }

  function matchesPart(element, selector) {
    if (selector === ":scope") return true;
    if (selector.includes(":not(")) {
      const excluded = selector.match(/:not\(([^)]+)\)/);
      if (excluded && matchesPart(element, excluded[1])) return false;
      selector = selector.replace(/:not\([^)]+\)/g, "");
    }
    if (selector.includes(":checked") && !element.checked) return false;
    if (selector.includes(":disabled") && !element.disabled) return false;
    selector = selector.replace(/:(checked|disabled|enabled|focus-visible)/g, "");
    const tag = selector.match(/^[\w-]+/);
    if (tag && element.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
    const id = selector.match(/#([\w-]+)/);
    if (id && element.id !== id[1]) return false;
    const classes = Array.from(selector.matchAll(/\.([\w-]+)/g), match => match[1]);
    if (!classes.every(name => element.classList.contains(name))) return false;
    const attributes = Array.from(selector.matchAll(/\[([\w-]+)(?:\s*([~*^$|]?=)\s*["']?([^"'\]]*)["']?)?\]/g));
    return attributes.every(([, name, operator, value]) => {
      if (!element.hasAttribute(name)) return false;
      if (!operator) return true;
      const actual = element.getAttribute(name);
      if (operator === "=") return actual === value;
      if (operator === "^=") return actual.startsWith(value);
      if (operator === "*=") return actual.includes(value);
      return false;
    });
  }

  class LiteElement {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = { ...attributes };
      this.children = [];
      this.parentElement = null;
      this.listeners = {};
      this.style = {};
      this._value = null;
      this._text = "";
      this.dataset = new Proxy({}, {
        get: (_, key) => this.getAttribute("data-" + String(key).replace(/[A-Z]/g, letter => "-" + letter.toLowerCase())) ?? undefined,
        set: (_, key, value) => { this.setAttribute("data-" + String(key).replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()), value); return true; }
      });
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(" "); },
        toggle: (name, force) => {
          const include = force === undefined ? !this.classList.contains(name) : force;
          this.classList[include ? "add" : "remove"](name);
          return include;
        }
      };
    }
    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get name() { return this.getAttribute("name") || ""; }
    get isConnected() { return Boolean(global.document?.contains(this)); }
    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }
    get hidden() { return this.hasAttribute("hidden"); }
    set hidden(value) { value ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); }
    get disabled() { return this.hasAttribute("disabled"); }
    set disabled(value) { value ? this.setAttribute("disabled", "") : this.removeAttribute("disabled"); }
    get open() { return this.hasAttribute("open"); }
    set open(value) { value ? this.setAttribute("open", "") : this.removeAttribute("open"); }
    get checked() { return this.hasAttribute("checked"); }
    set checked(value) { value ? this.setAttribute("checked", "") : this.removeAttribute("checked"); }
    get value() {
      if (this._value !== null) return this._value;
      if (this.tagName === "SELECT") {
        const options = this.querySelectorAll("option");
        return (options.find(option => option.hasAttribute("selected")) || options[0])?.value || "";
      }
      return this.getAttribute("value") || "";
    }
    set value(value) { this._value = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.children = []; this._text = String(value); }
    get innerHTML() { return this._html || ""; }
    set innerHTML(html) { this._html = String(html); this.children = []; this._text = ""; if (this.tagName === "SELECT") this._value = null; parse(this._html, this); }
    get elements() { return this.querySelectorAll("input, select, textarea, button"); }
    get options() { return this.querySelectorAll("option"); }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    matches(selector) { return selector.split(",").some(part => matchesPart(this, part.trim())); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      const all = [];
      const visit = element => element.children.forEach(child => { all.push(child); visit(child); });
      visit(this);
      return all.filter(element => selector.split(",").some(group => {
        const parts = group.trim().split(/\s+(?![^\[]*\])/);
        if (!matchesPart(element, parts.pop())) return false;
        let ancestor = element.parentElement;
        while (parts.length) {
          const part = parts.pop();
          while (ancestor && !matchesPart(ancestor, part)) ancestor = ancestor.parentElement;
          if (!ancestor) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== callback); }
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      event.currentTarget = this;
      for (const callback of this.listeners[event.type] || []) callback.call(this, event);
      if (event.bubbles && !event.stopped && this.parentElement) this.parentElement.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    focus() { global.document.activeElement = this; }
    scrollIntoView() { this.scrolledIntoView = true; }
    getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new LiteEvent("close")); }
    reset() { this.elements.forEach(element => { element._value = null; }); }
    click() { if (!this.disabled) this.dispatchEvent(new LiteEvent("click", { bubbles: true })); }
  }

  function parse(html, root) {
    const stack = [root];
    const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
    for (const match of html.matchAll(tokenPattern)) {
      const token = match[0];
      if (token.startsWith("<!")) continue;
      if (token.startsWith("</")) {
        const tag = token.match(/^<\/([\w-]+)/)[1].toUpperCase();
        const index = stack.map(item => item.tagName).lastIndexOf(tag);
        if (index > 0) stack.length = index;
      } else if (token.startsWith("<")) {
        const tag = token.match(/^<([\w-]+)/)[1];
        const attributes = {};
        const attrSource = token.slice(tag.length + 1, -1);
        for (const attr of attrSource.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          attributes[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
        }
        const element = new LiteElement(tag, attributes);
        stack[stack.length - 1].appendChild(element);
        if (!voidTags.has(tag.toLowerCase()) && !token.endsWith("/>")) stack.push(element);
      } else stack[stack.length - 1]._text += decode(token);
    }
  }

  const document = new LiteElement("document");
  parse(readFile("index.html"), document);
  document.getElementById = id => document.querySelector("#" + id);
  document.createElement = tag => new LiteElement(tag);
  document.documentElement = document.querySelector("html");
  document.body = document.querySelector("body");
  document.readyState = "complete";
  document.visibilityState = "visible";
  document.activeElement = document.body;
  global.window = global;
  global.document = document;
  global.Event = global.CustomEvent = LiteEvent;
  global.Element = global.HTMLElement = LiteElement;
  const media = new LiteElement("media-query");
  media.matches = true;
  global.matchMedia = () => media;
  global.location = { hash: "", protocol: "file:" };
  global.navigator = {};
  global.CSS = { escape: value => value };
  global.requestAnimationFrame = callback => callback();
  const intervals = new Map();
  let timerId = 0;
  global.setInterval = (callback, delay) => {
    const id = ++timerId;
    intervals.set(id, { callback, delay });
    return id;
  };
  global.clearInterval = id => intervals.delete(id);
  global.setTimeout = () => ++timerId;
  global.clearTimeout = () => {};
  // El reloj solo avanza explícitamente en las pruebas; no añade esperas reales.
  global.NovaTestEnvironment = {
    countIntervals: delay => [...intervals.values()].filter(timer => timer.delay === delay).length,
    tickIntervals: delay => [...intervals.values()].filter(timer => timer.delay === delay).forEach(timer => timer.callback()),
    setReducedMotion: matches => { media.matches = matches; media.dispatchEvent(new LiteEvent("change", { matches })); }
  };
  global.confirm = () => true;
  global.addEventListener = document.addEventListener.bind(document);
  global.removeEventListener = document.removeEventListener.bind(document);
  global.dispatchEvent = document.dispatchEvent.bind(document);
  global.console = { log: print, warn: print, error: print };
  const memory = {};
  global.localStorage = {
    getItem: key => memory[key] ?? null,
    setItem: (key, value) => { memory[key] = String(value); },
    removeItem: key => { delete memory[key]; },
    clear: () => { Object.keys(memory).forEach(key => { delete memory[key]; }); }
  };
}(globalThis));
