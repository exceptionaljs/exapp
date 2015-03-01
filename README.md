QApp
====

  * [Official Repository (jshq/qapp)](https://github.com/jshq/qapp)
  * [Unlicense] (http://unlicense.org)

QApp is a lightweight and zero dependency framework that can be used to develop applications composing of multiple modules. The framework itself defines a minimal interface that can be used to define modules, their dependencies, and a way how to start and stop them. It contains an interface for logging, module management, and application's lifetime management. Everything else has to be provided by application developers.

The reason `qapp` has been developed is that sometimes your application is not just an `express()` object. Many node modules and applications just create `express()`, put some variables into it, and use as many globals as they can in various modules for various purposes. The `qapp` philosophy is different - it tries to isolate everything within an `app` object. It allows to define modules that can be started / stopped in correct order; and let these modules share information they need through the `app` object. Every module can put its own information into `app` and other modules (that depend on it) can use it.
 
In addition, `qapp` allows to specify which modules to run. There are cases where one application instance runs only a subset of available modules. This is useful in cases that you want to share the whole code-base, but run several instances of your application having different configuration or different modules.


Application Object and Lifetime
-------------------------------

QApp contains only one class that can be extended by you or just used as is. The class is exported as `qapp.App` and can be instantiated by calling `new qapp.App()` or simply by calling `qapp()`. After called, it returns an application object (always referenced as `app` in documentation and tests) that should be the only top level object you have. In general, you don't even need to store the object anywhere as it can just live on its own.

The `qapp.App` constructor accepts an optional `opt` argument, which can be an object having the following properties:

  * `args` - Application arguments object/array. Not used directly by `qapp`, it's an arguments object that can be used by modules.
  * `config` - Application configuration object. Not used directly by `qapp`, it's a configuration that can be used by modules.
  * `logger` - An object that provides a `log(level, msg, ...)` function. If you use `winston` for logging you can just pass its instance, otherwise `qapp` will buffer all logs until you provide a logger that is compatible with the interface described (one of your modules can provide a logger).
  * `modules` - Application modules to register, passed to `App.register()`.

The `args`, `config`, and `logger` are the only public members within `qapp.App` that can be accessed directly. Everything else is available to modules, except `app._internal` (which is used exclusively by the implementation) and member functions provided by `qapp.App`.

The following example demonstrates how to start and stop a `qapp.App` application:

```JS
var qapp = require("qapp");

function main() {
  var app = qapp({
    // Configuration example.
    config: {
      http: {
        port: 80
      }
    }
  });

  // Start, the first parameters specifies which modules to start.
  app.start(["*"], function(err) {
    if (err) {
      // Handle a error that happened during startup.
      app.error("I failed to start :(");
      return;
    }

    // Your app is running...
    app.info("I'm running...");

    // ... do whatever ...

    // If you want to stop gratefully.
    app.stop(function(err) {
      app.info("I'm not running...");
      // ...
    });
  });
}

main();
```

That was a simple example, however, it should explain the basics. Your application's entry point will probably not be more complex than the example above, as the whole initialization and shutdown steps can be moved into modules that can use the `config` parameter to configure themselves.

More examples with modules are shown in sections below.


Application State
-----------------

Application's state can be retrieved by using `app.getState()`, which can return the following:

  * `qapp.kPending` - Application is pending, waiting for `start()` to be called.
  * `qapp.kStarting` - Application is starting, a `start()` has been called, but not all modules started.
  * `qapp.kRunning` - Application is running with all modules started successfully.
  * `qapp.kStopping` - Application is stopping, a `stop()` has been called, but not all modules stopped.
  * `qapp.kStopped` - Application is not running; all modules stopped successfully.
  * `qapp.kFailed` - Failed to either `start()` or `stop()`.

The following methods provide shortcuts for the most common states:

  * `app.isRunning()` - Returns `true` if the application's state is `kRunning`.
  * `app.isStopped()` - Returns `true` if the application's state is `kStopped`.


Logging Interface
-----------------

The `qapp.App` has the following members that can be used for logging purposes:

  * `log: function(level, msg, ...)` - The main logging interface. The `level` parameter can be `"silly"`, `"debug"`, `"info"`, `"warn"`, or `"error"`. These are the default levels supported by winston and used by `qapp`.
  * `silly: function(msg, ...)` - Calls `log` with level `"silly"`.
  * `debug: function(msg, ...)` - Calls `log` with level `"debug"`.
  * `info: function(msg, ...)` - Calls `log` with level `"info"`.
  * `warn: function(msg, ...)` - Calls `log` with level `"warn"`.
  * `error: function(msg, ...)` - Calls `log` with level `"error"`.
  * `switchToBufferedLogger()` - Switch to an internal buffered logger, changing the application's logger into a new logger that buffers all logs. Buffered logger is used by default by `qapp` until a real logger is plugged it.
  * `switchToExternalLogger(logger)` - Switch to an external `logger` that is compatible with the interface required by `qapp`.

The main idea is to simplify logging as much as possible, because it's one of the core concepts used by all modules.


Module Management
-----------------

A module is defined by an object that has the following signature:

```JS
var Module = {
  // Module name (mandatory).
  name: "module",

  // Dependencies (mandatory).
  deps: ["dependency1", "dependency2"],

  // Priority, less means higher (optional).
  priority: 0,

  // Start function (mandatory).
  start: function(app, cb) {
  },

  // Stop function (optional)
  stop: function(app, cb) {
  },

  // Anything else... (optional)
};
```

Mandatory members are required if the module wants to be recognizable by `qapp`, otherwise registering such module will fail (`TypeError`). Basically the only required members are `name`, `deps`, and `start()`. Other members are purely optional, however, you probably want provide `stop()` as well to perform a per module cleanup.

The module object can be immutable, when `start()` and `stop()` functions are called the `app` object is always provided. The purpose of modules is to store information in it during startup, and remove that information during shutdown. The functionality itself can be implemented as a class and just instantiated by the module.

The following example describes how to create and start application with modules:

```JS
var qapp = require("qapp");
var util = require("util");

// A logger compatible with `qapp.logger` interface. Implemented here to show
// how to implement your own logging if you don't use winston, for example.
var ConsoleLogger = {
  log: function(level, msg /*, ... */) {
    var s = "[" + level + "] " +
        util.format.apply(null, Array.prototype.slice.call(arguments, 1));
    console.log(s);
  }
};

var ModuleA = {
  name: "a",
  deps: [],

  start: function(app, next) {
    app.info(app.config.a.msg + " (start)");
    next();
  },

  stop: function(app, next) {
    app.info(app.config.a.msg + " (stop)");
    next();
  }
};

var ModuleB = {
  name: "b",
  deps: ["a"],

  start: function(app, next) {
    // Started after `a`.
    app.info(app.config.b.msg + " (start)");
    next();
  },

  stop: function(app, next) {
    // Stopped before `a`.
    app.info(app.config.b.msg + " (stop)");
    next();
  }
};

function main() {
  var app = qapp({
    logger: ConsoleLogger,
    config: {
      a: {
        msg: "Module 'a' is good"
      },
      b: {
        msg: "Module 'b' is better"
      }
    }
  });

  // Register modules.
  app.register([ModuleA, ModuleB]);

  // Start, the first parameters specifies which modules to start. Specifying
  // "b" will also start "a" as it's a dependency of "b".
  app.start(["b"], function(err) {
    if (err) {
      // Handle `err`.
    }

    app.info("I'm running...");

    // ... do whatever ...

    // If you want to stop gratefully.
    app.stop(function(err) {
    });
  });
}

main();
```

The example logs the following when run:

```
[silly] [APP] Starting.
[silly] [APP] Module 'a' starting.
[info] Module 'a' is good (start)
[silly] [APP] Module 'b' starting.
[info] Module 'b' is better (start)
[silly] [APP] Running.
[info] I'm running...
[silly] [APP] Stopping.
[silly] [APP] Module 'b' stopping.
[info] Module 'b' is better (stop)
[silly] [APP] Module 'a' stopping.
[info] Module 'a' is good (stop)
[silly] [APP] Stopped.
```
