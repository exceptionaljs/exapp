// xpart.js <https://github.com/exjs/xpart>
(function($export, $as) {
"use strict";

/**
 * XPart namespace - contains provided APIs and constants.
 *
 * @namespace
 * @alias xpart
 */
const xpart = {};
$export[$as] = xpart;

/**
 * XPart version in a "major.minor.patch" form.
 *
 * @alias xpart.VERSION
 */
const VERSION   = xpart.VERSION   = "1.0.0";

const kFailed   =-1;
const kPending  = 0;
const kStarting = 1;
const kRunning  = 2;
const kStopping = 3;
const kStopped  = 4;

const hasOwn  = Object.prototype.hasOwnProperty;
const isArray = Array.isArray;
const slice   = Array.prototype.slice;

// ============================================================================
// [Helpers]
// ============================================================================

function checkModule(m) {
  if (m == null || typeof m !== "object")
    return false;

  var name = m.name;
  if (typeof name !== "string" || name.length === 0 || name === "__proto__")
    return false;

  return isArray(m.deps) && typeof m.start === "function";
}

function printModule(m) {
  if (m == null && typeof m !== "object")
    return "<" + (m === null ? "null" : typeof m) + ">";
  else
    return "<" + (m.name ? m.name : "invalid") + ">";
}

function comparePriority(a, b) {
  return (a.priority || 0) - (b.priority || 0);
}

function resolveDependencies(registered, required) {
  // All modules to be initialized (map and array)
  var map = {};
  var req = [];

  var module, name;
  var deps, dependency;

  var i, j;

  // Fill all modules if required contains "*".
  if (required.indexOf("*") !== -1) {
    for (name in registered) {
      map[name] = false;
      req.push(name);
    }
  }

  // Fill `map` and `req` by module names specified by `required` argument.
  for (i = 0; i < required.length; i++) {
    name = required[i];
    if (hasOwn.call(map, name) || name === "*")
      continue;

    map[name] = false;
    req.push(name);
  }

  // Add all dependency names to `map` and `req`. The `req` array can grow
  // during the loop, but only module names that aren't in `map` are added.
  // In other words, `req` will still contain unique module names after the
  // loop ends.
  for (i = 0; i < req.length; i++) {
    name = req[i];

    if (!hasOwn.call(registered, name))
      return Error("Module '" + name + "' not found");

    module = registered[name];
    deps = module.deps;

    for (j = 0; j < deps.length; j++) {
      dependency = deps[j];
      if (hasOwn.call(map, dependency))
        continue;

      if (!hasOwn.call(registered, dependency))
        return Error("Module '" + name + "' dependency '" + dependency + "' not found");

      if (hasOwn.call(map, dependency))
        continue;

      map[dependency] = false;
      req.push(dependency);
    }
  }

  // Resolve the order of initialization of modules specified in `req`. All
  // modules that are already initialized will set `map[name]` to `true`.
  var result = [];
  var modulesCount = req.length;

  var resolved = [];
  var unresolved = [];

  var tmp;
  var isOk;
  var hasPriority;

  while (result.length !== modulesCount) {
    resolved.length = 0;
    hasPriority = false;

    // Collect all modules that can be initialized right now.
    for (i = 0; i < req.length; i++) {
      name = req[i];

      // Already resolved.
      if (map[name] === true)
        continue;

      module = registered[name];
      deps = module.deps;
      isOk = true;

      for (j = 0; j < deps.length; j++) {
        dependency = deps[j];
        if (map[dependency] === false) {
          isOk = false;
          break;
        }
      }

      if (isOk) {
        resolved.push(module);
        if (module.priority)
          hasPriority = true;
      }
      else {
        unresolved.push(name);
      }
    }

    if (resolved.length === 0)
      return Error("Cyclic dependency when resolving '" + req.join("', '") + "'");

    // If priority has been set in one or more module, sort by priority.
    if (hasPriority)
      resolved.sort(comparePriority);

    // Ok now push all modules from `thisRun` into the `result` array.
    for (i = 0; i < resolved.length; i++) {
      module = resolved[i];
      name = module.name;

      map[name] = true;
      result.push(name);
    }

    // Swap `req` and `unresolved` and clear `unresolved`.
    tmp = req;
    req = unresolved;
    unresolved = tmp;
    unresolved.length = 0;
  }

  return result;
}

function makeCallback(app, type, module, next) {
  var n = 0;
  return function(err) {
    if (++n !== 1) {
      // Put to log just once.
      if (n === 2)
        app.error("[xpart.app] Module '" + module.name + "' callbacked " + type + "() twice");
      throw new Error("Module '" + module.name + "' callbacked " + type + "() " + n + " times");
    }
    next(err);
  };
}

function makeLogFunc(level) {
  return function(msg /*[, ...]*/) {
    var logger = this.logger;
    var argLen = arguments.length;

    if (argLen <= 1) {
      logger.log(level, msg);
      return this;
    }

    var args = [level, msg];
    for (var i = 1; i < argLen; i++) {
      args.push(arguments[i]);
    }

    logger.log.apply(logger, args);
    return this;
  };
}

function callAsync(fn, err) {
  setImmediate(fn, err);
}

function callHandlers(app, action) {
  var handlers = app._internal.handlers;
  var list = handlers[action];

  // Prevents from adding new handlers for this action.
  handlers[action] = null;

  for (var i = 0, len = list.length; i < len; i++) {
    var handler = list[i];
    handler.func.call(handler.thisArg, app);
  }
}

// ============================================================================
// [API]
// ============================================================================

/**
 * Parses application's arguments from argv[] to an object.
 *
 * @param {string[]} argv Arguments array.
 * @param {number} [start=2] Where to start parsing.
 *
 * @alias xapp.parseArguments
 */
function parseArguments(argv, start) {
  var reOne = /^-(\w+)$/;
  var reTwo = /^--([^-][\w-]*)(=.*)?$/;

  var obj = {};
  var prevKey = "--";

  var m, k, v;

  // Default is to start processing from the third parameter.
  if (start == null)
    start = 2;

  for (var i = start; i < argv.length; i++) {
    v = argv[i];

    m = v.match(reOne);
    if (m) {
      v = m[1];
      for (var j = 0; j < v.length; j++)
        obj["-" + v[j]] = "true";
      continue;
    }

    m = v.match(reTwo);
    if (m) {
      k = m[1];
      v = m[2] ? m[2].substring(1) : true;
    }
    else {
      k = prevKey;
    }

    if (hasOwn.call(obj, k) && obj[k] !== true) {
      var prev = obj[k];

      if (v === true)
        continue;

      if (isArray(prev))
        prev.push(v);
      else
        obj[k] = [prev, v];
    }
    else {
      obj[k] = v;
    }

    prevKey = k;
  }

  for (k in obj) {
    if (obj[k] === true)
      obj[k] = "true";
  }

  return obj;
}
xpart.parseArguments = parseArguments;

/**
 * Modularizes a module or a class (that has to be instantiated) with `opt`.
 *
 * What this function does is to return an object that represents an xpart's
 * module based on `Module`. It basically returns the expected module object
 * that contains `start()` and `stop()` functions (which call start/stop on
 * the instantiated module) and other parameters based on `opt`.
 *
 * The following named parameters (keys in `opt`) are processed:
 *   `module` - Module or class to be instantiated (by using `new` operator) or
 *              by calling `module.new()`, which has a priority over using `new`
 *              operator.
 *   `as`     - Key in `app` to store the instantiated module to. If `as` is not
 *              present `name` will be used instead.
 *   `name`   - Module name, if not specified `module.name` would be used.
 *   `deps`   - Module dependencies, added to possible deps specified by `module`.
 *   `config` - Module configuration, passed to the module constructor.
 *
 * The returned module can be instantiated by `new Module(app, config)`.
 *
 * @param {object} opt Object that describes the module.
 * @return {object} Object that's compatible with xpart's module interface.
 *
 * @alias xpart.modularize
 */
function modularize(opt) {
  var Module = opt.module;
  var instance = null;

  var name = opt.name || Module.name;
  if (!name)
    throw new TypeError("xpart.modularize() - Name not specified");

  var as = opt.as || name;
  var deps = (Module.deps || []).concat(opt.deps || []);
  var optCfg = opt.config;

  function start(app, cb) {
    var config = null;

    if (!optCfg)
      optCfg = name;

    if (typeof optCfg === "object" && optCfg !== null) {
      // If the `config` is an object we just pass it to the module as-is.
      config = optCfg;
    }
    else if (typeof optCfg === "string" && hasOwn.call(app.config, optCfg)) {
      // If the `config` is a string then it's a key of the `app.config`.
      config = app.config[optCfg];
    }

    // If no configuration has been provided we default to an empty object.
    if (config == null)
      config = {};

    if (hasOwn.call(Module, "new"))
      instance = Module["new"](app, config);
    else
      instance = new Module(app, config);

    app[as] = instance;
    instance.start(cb);
  }

  function stop(app, cb) {
    function resetCb(err) {
      // Reset only if the `stop` haven't failed.
      if (!err)
        app[as] = null;
      cb(err);
    }

    if (typeof instance.stop === "function")
      instance.stop(resetCb);
    else
      setImmediate(resetCb, null);
  }

  return {
    name    : name,
    deps    : deps,
    priority: (opt.priority || Module.priority) || 0,
    start   : start,
    stop    : stop
  };
}
xpart.modularize = modularize;

// ============================================================================
// [BufferedLogger]
// ============================================================================

/**
 * Logger that is initialized if no default logger is provided. It buffers all
 * logs before the real logger can consume them.
 *
 * @private
 */
class BufferedLogger {
  constructor() {
    this._logs = [];
  }

  log(/* level, msg, ... */) {
    this._logs.push(slice.call(arguments, 0));
  }
}

// ============================================================================
// [App]
// ============================================================================

/**
 * Application.
 *
 * @class
 * @alias xpart.App
 */
class App {
  constructor(opt) {
    if (!opt)
      opt = {};

    // Application arguments / configuration [PUBLIC].
    this.args   = opt.args   || {};
    this.config = opt.config || {};

    // Application logging interface [PUBLIC].
    this.logger = opt.logger || null;

    // Application internals [PRIVATE].
    this._internal = {
      state       : kPending, // Application's state.
      registered  : {},       // Modules registered.
      running     : {},       // Modules running.
      initIndex   : -1,       // Module initialization index.
      initOrder   : null,     // Module initialization order.

      handlers: {
        afterStart: [],       // Handlers called after successful start.
        afterStop : []        // Handlers called after successful stop.
      },

      properties: {
        // Stop error.
        stopError: null,

        // Whether to call `stop()` automatically if `start()` fails.
        stopOnFail: Boolean(opt.stopOnFail)
      }
    };

    // Setup logger, bail to BufferedLogger if there is no logger in `opt`.
    if (this.logger === null)
      this.switchToBufferedLogger();

    // Add modules, these can use built-in logger.
    if (opt.modules)
      this.register(opt.modules);
  }

  // --------------------------------------------------------------------------
  // [Logging Interface]
  // --------------------------------------------------------------------------

  /**
   * Logs a message through the application's logger.
   *
   * @param {string} level Logging level ("silly", "debug", "info", "warn", "error").
   * @param {message} Message (can contain sprintf-like formatting).
   * @param {...*} {args} Sprintf-like arguments
   *
   * @return {this}
   */
  log(/*...*/) {
    var logger = this.logger;
    logger.log.apply(logger, arguments);
    return this;
  }

  /**
   * Switches the application's logger to a buffered logger that does only
   * buffering of all messages, but doesn't print them.
   *
   * This logger is set by default on application's startup and buffers all
   * messages until a real logger is set by `switchToExternalLogger()` call.
   *
   * @return {this}
   */
  switchToBufferedLogger() {
    this.logger = new BufferedLogger();
    return this;
  }

  /**
   * Switches the application's logger to the given external `logger`.
   *
   * If the current application's is a buffered logger then all buffered
   * messages will be send to the new `logger`. This ensures that no messages
   * will be lost between the real logger is set.
   *
   * @param {object} logger External logger to use for logging.
   * @return {this}
   */
  switchToExternalLogger(logger) {
    var prev = this.logger;
    this.logger = logger;

    if (prev && isArray(prev._logs)) {
      var logs = prev._logs;
      for (var i = 0; i < logs.length; i++)
        this.log.apply(this, logs[i]);
    }

    return this;
  }

  // --------------------------------------------------------------------------
  // [Properties]
  // --------------------------------------------------------------------------

  /**
   * Gets whether the application has a property called `name`.
   *
   * @param {string} name Property name to check
   * @return {boolean} Whether the property exists.
   */
  hasProperty(name) {
    switch (name) {
      case "args":
      case "config":
      case "logger":
      case "state":
        return true;

      default:
        return hasOwn.call(this._internal.properties, name);
    }
  }

  /**
   * Returns the content of the property called `name`.
   *
   * @param {string} name Property name to retrieve.
   * @return {*} The content of the property.
   *
   * @throws {TypeError} If the property doesn't exist.
   */
  getProperty(name) {
    var internal = this._internal;
    switch (name) {
      case "args":
      case "config":
      case "logger":
        return this[name];

      case "state":
        return internal.state;
    }

    var properties = internal.properties;
    if (!hasOwn.call(properties, name))
      throw new TypeError("Invalid property '" + name + "'");

    return properties[name];
  }

  /**
   * Sets the content of a property `name` to `value`.
   *
   * @param {string} name Property name to set.
   * @param {*} value A new value of the property.
   *
   * @return {this}
   *
   * @throws {TypeError} If the property doesn't exist or is read-only.
   */
  setProperty(name, value) {
    // Handle `setProperty(Object)`.
    if (arguments.length === 1 && typeof name === "object") {
      for (var k in name)
        this.setProperty(k, name[k]);
      return this;
    }

    var internal = this._internal;
    switch (name) {
      case "args":
      case "config":
        this[name] = value;
        return this;

      case "logger":
        if (value)
          return this.switchToBufferedLogger();
        else
          return this.switchToExternalLogger(value);

      case "state":
        throw new TypeError("Property '" + name + "' is read-only");
    }

    var properties = internal.properties;
    if (!hasOwn.call(properties, name))
      throw new TypeError("Invalid property '" + name + "'");

    properties[name] = value;
    return this;
  }

  // --------------------------------------------------------------------------
  // [Module Interface]
  // --------------------------------------------------------------------------

  /**
   * Registers a single module or multiple modules specifed by `m`.
   *
   * If a module is registered it doesn't mean it has to run, it means that it's
   * available to be instantiated. Modules to be run are passed in `App.start()`.
   *
   * @param {object, object[]) m Module or modules (array) to register.
   * @param {string=} path Optional path of the module (for debugging purposes).
   * @return {this}
   */
  register(m, path) {
    if (isArray(m)) {
      var modules = m;
      path = path || "";

      for (var i = 0, len = modules.length; i < len; i++)
        this.register(modules[i], path + "[" + String(i) + "]");
    }
    else {
      this._register(m, path || "<root>");
    }
    return this;
  }

  /**
   * Registers a single module, called by `register()`.
   *
   * @param {object} m Module to register
   * @param {string} path Module path (for debugging purposes).
   *
   * @private
   */
  _register(m, path) {
    if (!checkModule(m))
      throw new TypeError("Invalid signature of a module '" + path + "' " + printModule(m));

    this._internal.registered[m.name] = m;
  }

  /**
   * Gets if the module `m` has been registered.
   *
   * @param {string|object} m Module name as string or module instance.
   * @return {boolean} True if module has been registered, false otherwise.
   *
   * @throws {TypeError} If the `m` parameter is invalid (not string nor module).
   */
  isModuleRegistered(m) {
    var internal = this._internal;

    if (typeof m === "string")
      return hasOwn.call(internal.registered, m);
    else if (checkModule(m))
      return hasOwn.call(internal.registered, m.name);
    else
      throw new TypeError("Invalid argument");
  }

  /**
   * Gets if the module `m` is running.
   *
   * @param {string|object} m Module name as string or module instance.
   * @return {boolean} True if module is running, false otherwise.
   *
   * @throws {TypeError} If the `m` parameter is invalid (not string nor module).
   */
  isModuleRunning(m) {
    var internal = this._internal;

    if (typeof m === "string")
      return hasOwn.call(internal.loaded, m);
    else if (checkModule(m))
      return hasOwn.call(internal.loaded, m.name);
    else
      throw new TypeError("Invalid argument");
  }

  /**
   * Returns all modules registered as a mapping between module names and objects.
   *
   * @return {object} Object where keys are module names and values are module
   * objects.
   */
  getModulesRegistered() {
    return this._internal.registered;
  }

  /**
   * Returns all modules running as a mapping between module names and objects.
   *
   * @return {object} Object where keys are module names and values are module
   * objects.
   */
  getModulesRunning() {
    return this._internal.running;
  }

  // --------------------------------------------------------------------------
  // [Lifetime Interface]
  // --------------------------------------------------------------------------

  /**
   * Returns the application's state.
   *
   * @return {number}
   */
  getState() {
    return this._internal.state;
  }

  /**
   * Gets whether the application is running (i.e. all modules started).
   *
   * @return {boolean}
   */
  isRunning() {
    return this._internal.state === kRunning;
  }

  /**
   * Gets whether the application has been stopped (i.e. all modules stopped).
   *
   * @return {boolean}
   */
  isStopped() {
    return this._internal.state === kStopped;
  }

  /**
   * Starts the application.
   *
   * NOTE: The function throws only if the application state is wrong, it never
   * throws if a module failed to start or a dependency management failed, in
   * such cases it passes an error to the provided start callback.
   *
   * @param {string[]} required Array of module names, which are required to
   *   start the application.
   * @param {function} cb Start callback, which is called after the application
   *   starts or when fails to start.
   * @return {this}
   *
   * @throws {Error} If the application state is not `App.kPending`, which means
   *   that the `App.start()` has been attempted to start multiple times.
   */
  start(required, cb) {
    var self = this;
    var internal = this._internal;

    if (internal.state !== kPending) {
      var msg = "Attempt to start app multiple times";

      self.log("error", "[xpart.app] " + msg);
      throw new Error(msg);
    }

    self.log("silly", "[xpart.app] Starting");
    internal.state = kStarting;

    var order = resolveDependencies(internal.registered, required);
    var module = null;

    if (order instanceof Error) {
      internal.state = kFailed;
      callAsync(cb, order);

      return this;
    }

    var syncOk = 0;
    var index;

    internal.initIndex = -1;
    internal.initOrder = order;

    function failed(err) {
      internal.state = kFailed;

      // Handle the option `stopOnFail`.
      if (internal.properties.stopOnFail) {
        self.stop(function(stopErr) {
          callAsync(cb, err);
        });
      }
      else {
        callAsync(cb, err);
      }
    }

    function iterate(err) {
      if (err) {
        self.log("error", "[xpart.app] Module '" + module.name + "' failed to start: " + err.message);
        return failed(err);
      }

      // Return immediately and handle the result without recursing if sync.
      if (--syncOk === 0)
        return;

      for (;;) {
        index = ++internal.initIndex;
        syncOk = 1;

        if (index >= order.length) {
          self.log("silly", "[xpart.app] Running");
          internal.state = kRunning;

          callAsync(cb, null);
          callHandlers(self, "afterStart");

          return;
        }

        module = internal.registered[order[index]];
        self.log("silly", "[xpart.app] Module '" + module.name + "' starting");

        try {
          module.start(self, makeCallback(self, "start", module, iterate));
        } catch (ex) {
          self.log("error", "[xpart.app] Module '" + module.name + "' failed to start (thrown): " + ex.message);
          return failed(ex);
        }

        if (++syncOk !== 1)
          break;
      }
    }

    iterate(null);
    return this;
  }

  /**
   * Stops the application.
   *
   * NOTE: The function throws only if the application state is wrong, it never
   * throws if a module failed to stop, in such case it passes an error to the
   * provided start callback.
   *
   * @param {function} cb Stop callback, which is called after the application
   *   stops or when fails to start.
   * @return {this}
   */
  stop(cb) {
    var self = this;
    var internal = this._internal;

    var toState = kStopped;
    var stopMsg = "";

    if (internal.state !== kRunning) {
      if (internal.state === kFailed && internal.initIndex !== -1) {
        toState = kFailed;
        stopMsg = " (stopOnFail)";
      }
      else {
        var msg = internal.state < kRunning
          ? "Attempt to stop a non-running app"
          : "Attempt to stop app multiple times";

        self.log("error", "[xpart.app] " + msg);
        throw new Error(msg);
      }
    }

    self.log("silly", "[xpart.app] Stopping" + stopMsg);
    internal.state = kStopping;

    var order = internal.initOrder;
    var module = null;

    var syncOk = 0;
    var index;

    function failed(err) {
      internal.state = kFailed;
      internal.properties.stopError = err;

      callAsync(cb, err);
    }

    function iterate(err) {
      if (err) {
        self.log("error", "[xpart.app] Module '" + module.name + "' failed to stop: " + err.message);
        return failed(err);
      }

      // Return immediately and handle the result without recursing if sync.
      if (--syncOk === 0)
        return;

      for (;;) {
        index = --internal.initIndex;
        syncOk = 1;

        if (index === -1) {
          self.log("silly", "[xpart.app] Stopped" + stopMsg);
          internal.state = toState;

          callAsync(cb, null);
          callHandlers(self, "afterStop");

          return;
        }

        module = internal.registered[order[index]];
        self.log("silly", "[xpart.app] Module '" + module.name + "' stopping" + (module.stop ? "" : " (no callback)"));

        if (typeof module.stop === "function") {
          try {
            module.stop(self, makeCallback(self, "stop", module, iterate));
          } catch (ex) {
            self.log("error", "[xpart.app] Module '" + module.name + "' failed to stop (thrown): " + ex.message);
            return failed(ex);
          }

          if (++syncOk !== 1)
            break;
        }
      }
    }

    iterate(null);
    return this;
  }

  // --------------------------------------------------------------------------
  // [Handlers]
  // --------------------------------------------------------------------------

  /**
   * Adds a handler that will be fired once after the given `action` has happened.
   * The following handlers are available:
   *
   *   - `"afterStart"` - Called after the application started successfully.
   *   - `"afterStop"`  - Called after the application stopped successfully.
   */
  addHandler(action, func, thisArg) {
    var handlers = this._internal.handlers;

    if (!hasOwn.call(handlers, action))
      throw new Error("Action '" + action + "' doesn't exist");

    var list = handlers[action];
    if (list === null)
      throw new Error("Action '" + action + "' has already fired");

    list.push({ func: func, thisArg: thisArg || null });
    return this;
  }
}
xpart.App = App;

/**
 * The application is in a failure state (either start or stop failed).
 * @alias xpart.App.kFailed
 */
App.kFailed = kFailed;

/**
 * The application is in a pending state (haven't started yet).
 * @alias xpart.App.kPending
 */
App.kPending  = kPending;

/**
 * The application is in a starting state (`start()` called, but haven't finished).
 * @alias xpart.App.kStarting
 */
App.kStarting = kStarting;

/**
 * The application is in a running state (`start()` finished sucessfully).
 * @alias xpart.App.kRunning
 */
App.kRunning  = kRunning;

/**
 * The application is in a stopping state (`stop()` called, but haven't finished).
 * @alias xpart.App.kStopping
 */
App.kStopping = kStopping;

/**
 * The application is in a stopped state (`stop()` finished sucessfully).
 * @alias xpart.App.kStopped
 */
App.kStopped  = kStopped;

/**
 * Log a silly message.
 *
 * @param {message} Message (can contain sprintf-like formatting).
 * @param {...*} {args} Sprintf-like arguments
 *
 * @function
 * @alias xpart.App.prototype.silly
 */
App.prototype.silly = makeLogFunc("silly");

/**
 * Log a debug message.
 *
 * @param {message} Message (can contain sprintf-like formatting).
 * @param {...*} {args} Sprintf-like arguments
 *
 * @function
 * @alias xpart.App.prototype.debug
 */
App.prototype.debug = makeLogFunc("debug");

/**
 * Log an informative message.
 *
 * @param {message} Message (can contain sprintf-like formatting).
 * @param {...*} {args} Sprintf-like arguments
 *
 * @function
 * @alias xpart.App.prototype.info
 */
App.prototype.info  = makeLogFunc("info");

/**
 * Log a warning message.
 *
 * @param {message} Message (can contain sprintf-like formatting).
 * @param {...*} {args} Sprintf-like arguments
 *
 * @function
 * @alias xpart.App.prototype.warn
 */
App.prototype.warn  = makeLogFunc("warn");

/**
 * Log an error message.
 *
 * @param {message} Message (can contain sprintf-like formatting).
 * @param {...*} {args} Sprintf-like arguments
 *
 * @function
 * @alias xpart.App.prototype.error
 */
App.prototype.error = makeLogFunc("error");

/**
 * Shorthand for `new xpart.App()`.
 *
 * @return {App} A new xpart.App instance.
 *
 * @function
 * @alias xpart.app
 */
xpart.app = function app(opt) { return new App(opt); };

}).apply(this, typeof module === "object" ? [module, "exports"] : [this, "xpart"]);
