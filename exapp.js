// exapp.js <https://github.com/exceptionaljs/exapp>
(function($export, $as) {
"use strict";

// \namespace `exapp`
//
// exapp.js namespace, contains exposed API and constants.
function exapp(opt) {
  return new App(opt);
}

// `exapp.VERSION`
//
// Version information in a "major.minor.patch" form.
exapp.VERSION = "1.0.0";

// ============================================================================
// [Constants]
// ============================================================================

var kFailed   = exapp.kFailed   =-1;
var kPending  = exapp.kPending  = 0;
var kStarting = exapp.kStarting = 1;
var kRunning  = exapp.kRunning  = 2;
var kStopping = exapp.kStopping = 3;
var kStopped  = exapp.kStopped  = 4;

// ============================================================================
// [Internals]
// ============================================================================

var hasOwn = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;
var slice = Array.prototype.slice;

function merge(dst, src) {
  for (var k in src)
    dst[k] = src[k];
  return dst;
}

// ============================================================================
// [BufferedLogger]
// ============================================================================

// Logger that is initialized if no default logger is provided. It buffers all
// logs and once a real logger is plugged in all messages can be send to it.
function BufferedLogger() {
  this._logs = [];
}
BufferedLogger.prototype.log = function(/* level, msg, ... */) {
  this._logs.push(slice.call(arguments, 0));
};

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
        return Error("Module '" + name + "' dependency '" + dependency + "' not found.");

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
      return Error("Cyclic dependency when resolving '" + req.join("', '") + "'.");

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
        app.error("[APP] Module '" + module.name + "' callbacked " + type + "() twice.");
      throw new Error("Module '" + module.name + "' callbacked " + type + "() " + n + " times.");
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
// [Utilities]
// ============================================================================

// Parse application's arguments from argv[] to an object.
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
exapp.parseArguments = parseArguments;

// ============================================================================
// [App]
// ============================================================================

// \class `exapp.App`
//
// Application class.
function App(opt) {
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

merge(App.prototype, {
  // --------------------------------------------------------------------------
  // [Logging Interface]
  // --------------------------------------------------------------------------

  log: function(/*...*/) {
    var logger = this.logger;
    logger.log.apply(logger, arguments);
    return this;
  },

  silly: makeLogFunc("silly"),
  debug: makeLogFunc("debug"),
  info : makeLogFunc("info"),
  warn : makeLogFunc("warn"),
  error: makeLogFunc("error"),

  switchToBufferedLogger: function() {
    this.logger = new BufferedLogger();
    return this;
  },

  switchToExternalLogger: function(logger) {
    var prev = this.logger;
    this.logger = logger;

    if (prev && isArray(prev._logs)) {
      var logs = prev._logs;
      for (var i = 0; i < logs.length; i++)
        this.log.apply(this, logs[i]);
    }

    return this;
  },

  // --------------------------------------------------------------------------
  // [Properties]
  // --------------------------------------------------------------------------

  hasProperty: function(name) {
    switch (name) {
      case "args":
      case "config":
      case "logger":
      case "state":
        return true;

      default:
        return hasOwn.call(this._internal.properties, name);
    }
  },

  getProperty: function(name) {
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
      throw new TypeError("Invalid property '" + name + "'.");

    return properties[name];
  },

  setProperty: function(name, value) {
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
        throw new TypeError("Property '" + name + "' is read-only.");
    }

    var properties = internal.properties;
    if (!hasOwn.call(properties, name))
      throw new TypeError("Invalid property '" + name + "'.");

    properties[name] = value;
    return this;
  },

  // --------------------------------------------------------------------------
  // [Module Interface]
  // --------------------------------------------------------------------------

  // \function `App.register(m)`
  //
  // Register a single module or multiple modules, specifed by `m`.
  //
  // If a module is registered it doesn't mean it has to run, it means that it's
  // available to be instantiated. Modules to be run are passed in `App.start()`.
  register: function(m, path) {
    if (isArray(m)) {
      var modules = m;
      path = path || "";

      for (var i = 0, len = modules.length; i < len; i++)
        this.register(modules[i], path + "[" + String(i) + "]");

      return this;
    }

    this._register(m, path || "<root>");
    return this;
  },

  // \internal
  _register: function(m, path) {
    if (!checkModule(m))
      throw new TypeError("Invalid signature of a module '" + path + "' " + printModule(m) + ".");

    this._internal.registered[m.name] = m;
  },

  // \function `App.isModuleRegistered(m)`
  //
  // Get whether the module `m` has been registered.
  isModuleRegistered: function(m) {
    var internal = this._internal;

    if (typeof m === "string")
      return hasOwn.call(internal.registered, m);
    else if (checkModule(m))
      return hasOwn.call(internal.registered, m.name);
    else
      throw new TypeError("Invalid argument.");
  },

  // \function `App.isModuleRunning(m)`
  //
  // Get whether the module `m` is running.
  isModuleRunning: function(m) {
    var internal = this._internal;

    if (typeof m === "string")
      return hasOwn.call(internal.loaded, m);
    else if (checkModule(m))
      return hasOwn.call(internal.loaded, m.name);
    else
      throw new TypeError("Invalid argument.");
  },

  // \function `App.getModulesRegistered()`
  //
  // Get all modules registered as a mapping between module names and objects.
  getModulesRegistered: function() {
    return this._internal.registered;
  },

  // \function `App.getModulesRunning()`
  //
  // Get all modules running as a mapping between module names and objects.
  getModulesRunning: function() {
    return this._internal.running;
  },

  // --------------------------------------------------------------------------
  // [Lifetime Interface]
  // --------------------------------------------------------------------------

  getState: function() {
    return this._internal.state;
  },

  // \function `App.isRunning()`
  //
  // Get whether the application is started (i.e. all modules started).
  isRunning: function() {
    return this._internal.state === kRunning;
  },

  // \function `App.isStopped()`
  //
  // Get whether the application is stopped (i.e. all modules stopped).
  isStopped: function() {
    return this._internal.state === kStopped;
  },

  // \function `App.start(required, cb)`
  //
  // Start the application.
  start: function(required, cb) {
    var self = this;
    var internal = this._internal;

    if (internal.state !== kPending) {
      var msg = "Attempt to start app multiple times.";

      self.log("error", "[APP] " + msg);
      throw new Error(msg);
    }

    self.log("silly", "[APP] Starting.");
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
        self.log("error", "[APP] Module '" + module.name + "' failed to start: " + err.message);
        return failed(err);
      }

      // Return immediately and handle the result without recursing if sync.
      if (--syncOk === 0)
        return;

      for (;;) {
        index = ++internal.initIndex;
        syncOk = 1;

        if (index >= order.length) {
          self.log("silly", "[APP] Running.");
          internal.state = kRunning;

          callAsync(cb, null);
          callHandlers(self, "afterStart");

          return;
        }

        module = internal.registered[order[index]];
        self.log("silly", "[APP] Module '" + module.name + "' starting.");

        try {
          module.start(self, makeCallback(self, "start", module, iterate));
        } catch (ex) {
          self.log("error", "[APP] Module '" + module.name + "' failed to start (thrown): " + ex.message);
          return failed(ex);
        }

        if (++syncOk !== 1)
          break;
      }
    }

    iterate(null);
    return this;
  },

  // \function `App.stop(cb)`
  //
  // Stop the application.
  stop: function(cb) {
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
          ? "Attempt to stop a non-running app."
          : "Attempt to stop app multiple times.";

        self.log("error", "[APP] " + msg);
        throw new Error(msg);
      }
    }

    self.log("silly", "[APP] Stopping" + stopMsg + ".");
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
        self.log("error", "[APP] Module '" + module.name + "' failed to stop: " + err.message);
        return failed(err);
      }

      // Return immediately and handle the result without recursing if sync.
      if (--syncOk === 0)
        return;

      for (;;) {
        index = --internal.initIndex;
        syncOk = 1;

        if (index === -1) {
          self.log("silly", "[APP] Stopped" + stopMsg + ".");
          internal.state = toState;

          callAsync(cb, null);
          callHandlers(self, "afterStop");

          return;
        }

        module = internal.registered[order[index]];
        self.log("silly", "[APP] Module '" + module.name + "' stopping" + (module.stop ? "" : " (no callback)") + ".");

        if (typeof module.stop === "function") {
          try {
            module.stop(self, makeCallback(self, "stop", module, iterate));
          } catch (ex) {
            self.log("error", "[APP] Module '" + module.name + "' failed to stop (thrown): " + ex.message);
            return failed(ex);
          }

          if (++syncOk !== 1)
            break;
        }
      }
    }

    iterate(null);
    return this;
  },

  // --------------------------------------------------------------------------
  // [Handlers]
  // --------------------------------------------------------------------------

  // Add a handler that will be fired once after some `action` happened. The
  // following handlers are available:
  //
  //   - "afterStart" - Called after successful application's start.
  //   - "afterStop"  - Called after successful application's stop.
  addHandler: function(action, func, thisArg) {
    var handlers = this._internal.handlers;

    if (!hasOwn.call(handlers, action))
      throw new Error("Action '" + action + "' doesn't exist.");

    var list = handlers[action];
    if (list === null)
      throw new Error("Action '" + action + "' has already fired.");

    list.push({ func: func, thisArg: thisArg || null });
    return this;
  }
});
exapp.App = App;

$export[$as] = exapp;

}).apply(this, typeof module === "object" ? [module, "exports"] : [this, "exapp"]);
