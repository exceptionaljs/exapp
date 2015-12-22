exapp.js
========

  * [Official Repository (exjs/exapp)](https://github.com/exjs/exapp)
  * [Public Domain (unlicense.org)](http://unlicense.org)

exapp.js is an extensible application framework for node.js that has zero dependencies. It can be used to develop applications composing of multiple modules with a possibility to specify which modules to use. The framework itself defines a minimal interface that can be used to define modules, their dependencies, and a way how to start and stop them. It contains an interface for logging, module management, and application's lifetime management. Everything else has to be provided by exapp.js consumers.

The reason exapp.js has been developed is that sometimes your application is not just an `express()` object. Many node modules and applications just create `express()`, put some variables into it, and use as many globals as they can in various modules for various purposes. The exapp.js philosophy is different - it tries to isolate everything within an `app` object. It allows to define modules that can be started / stopped in a correct order; and let these modules share information they need through the `app` object. Every module can put its own information into `app` and other modules (that depend on it) can use it.

The framework allows to specify which modules to run on application startup. There are cases where one application instance runs only a subset of available modules. This is useful in cases that you want to share the whole code-base, but run several instances of your application having different configuration or different modules.


Application Object and Lifetime
-------------------------------

The framework provides only one class that can be extended by you or just used as is. The class is exported as `exapp.App` and can be instantiated by calling `new exapp.App()` or simply by calling `exapp()`. After called, it returns an application object (always referenced as `app` in documentation and tests) that should be the only top level object you have. In general, you don't even need to store the object anywhere as it can just live on its own.

The `exapp.App` constructor accepts an optional `opt` argument, which can be an object having the following properties:

  * `args` - Application arguments object. Not used directly by exapp.js, it's an arguments object that can be used by modules. You can use `exapp.parseArguments()` utility function to parse command line arguments and turn them into a dictionary, but the functionality is rather limited. If you need a more robust arguments parsing you should consider some third party libraries.
  * `config` - Application configuration object. Not used directly by `exapp`, it's a configuration that can be used by modules.
  * `logger` - An object that provides a `log(level, msg, ...)` function. If you use `winston` for logging you can just pass its instance, otherwise `exapp` will buffer all logs until you provide a logger that is compatible with the interface described (one of your modules can provide a logger).
  * `modules` - Application modules to register, passed to `App.register()`.

The `args`, `config`, and `logger` are the only public members within `exapp.App` that can be accessed directly. Everything else is available to modules, except `app._internal` (which is used exclusively by the implementation) and member functions provided by `exapp.App`.

The following example demonstrates how to start and stop a `exapp.App` application:

```js
var exapp = require("exapp");

function main() {
  var app = exapp({
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


Application's State
-------------------

Application's state can be retrieved by using `app.getState()`, which can return the following:

  * `exapp.kPending` - Application is pending, waiting for `start()` to be called.
  * `exapp.kStarting` - Application is starting, a `start()` has been called, but not all modules started.
  * `exapp.kRunning` - Application is running with all modules started successfully.
  * `exapp.kStopping` - Application is stopping, a `stop()` has been called, but not all modules stopped.
  * `exapp.kStopped` - Application is not running; all modules stopped successfully.
  * `exapp.kFailed` - Failed to either `start()` or `stop()`.

The following methods provide shortcuts for the most common states:

  * `app.isRunning()` - Returns `true` if the application's state is `kRunning`.
  * `app.isStopped()` - Returns `true` if the application's state is `kStopped`.


Application's Properties
------------------------

The `exapp.App` has the following member functions that can be used to access various properties:

  * `hasProperty(name)` - Get whether the property `name` does exist.
  * `getProperty(name)` - Get the value of the property `name`. The function throws if the property doesn't exist.
  * `setProperty(name, value)` - Set the value of the property `name` to `value`. The function throws if the property doesn't exist or is read-only.

The following properties are recognized:

  * `args`       - Application's arguments, also accessible through `app.args`.
  * `config`     - Application's configuration, also accessible through `app.config`.
  * `logger`     - Application's logger, also accessible through `app.logger`.
  * `state`      - Application's state, also accessible through `app.getState()`.
  * `stopError`  - The error that happened during application's shutdown (default `null`).
  * `stopOnFail` - Whether the application should automatically call `stop()` if start failed (default `false`).

Application's Logger
--------------------

The `exapp.App` has the following member functions that can be used for logging purposes:

  * `log(level, msg, ...)` - The main logging interface. The `level` parameter can be `"silly"`, `"debug"`, `"info"`, `"warn"`, or `"error"`. These are the default levels supported by winston and used by exapp.js.
  * `silly(msg, ...)` - Calls `log` with level `"silly"`.
  * `debug(msg, ...)` - Calls `log` with level `"debug"`.
  * `info(msg, ...)` - Calls `log` with level `"info"`.
  * `warn(msg, ...)` - Calls `log` with level `"warn"`.
  * `error(msg, ...)` - Calls `log` with level `"error"`.
  * `switchToBufferedLogger()` - Switch to an internal buffered logger, changing the application's logger into a new logger that buffers all logs. Buffered logger is used by default by exapp.js until a real logger is plugged it.
  * `switchToExternalLogger(logger)` - Switch to an external `logger` that is compatible with the interface required by exapp.js.

The main idea is to simplify logging as much as possible, because it's one of the core concepts used by all modules.


Application's Module Management
-------------------------------

A module is defined by an object that has the following signature:

```js
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

Mandatory members are required if the module wants to be recognizable by exapp.js, otherwise registering such module will fail (`TypeError`). Basically the only required members are `name`, `deps`, and `start()`. Other members are purely optional, however, you probably want provide `stop()` as well to perform a per module cleanup.

The module object can be immutable, when `start()` and `stop()` functions are called the `app` object is always provided. The purpose of modules is to store information in it during startup, and remove that information during shutdown. The functionality itself can be implemented as a class and just instantiated by the module.

The following example describes how to create and start application with modules:

```js
var exapp = require("exapp");
var util = require("util");

// A logger compatible with `exapp.logger` interface. Implemented here to show
// how to implement your own logging if you don't use winston, for example.
var ConsoleLogger = {
  log: function(level, msg /*, ... */) {
    var s = "[" + level + "] " +
        util.format.apply(null, Array.prototype.slice.call(arguments, 1));
    console.log(s);
  }
};

// Define a ModuleA. This object conforms to a signature expected by exapp.js.
var ModuleA = {
  name: "a",
  deps: [],

  start: function(app, next) {
    app.info(app.config.a.msg + " (start)");

    // Modules can associate their own data with app. This is the way the app
    // object is used. The `ModuleA` itself is available as `this`. However,
    // modules shouldn't write to `this` as it's considered a global object.
    app.a = {};

    next();
  },

  stop: function(app, next) {
    app.info(app.config.a.msg + " (stop)");

    // If your application architecture is 100% clean then removing the module's
    // data shouldn't cause any harm.
    app.a = null;

    next();
  }
};

// Define a ModuleB which depends on ModuleA.
var ModuleB = {
  name: "b",
  deps: ["a"],

  start: function(app, next) {
    // Started after `a`.
    app.info(app.config.b.msg + " (start)");

    // Since `b` is started after `a` it can use its data.
    app.a.b = {};

    next();
  },

  stop: function(app, next) {
    // Stopped before `a`.
    app.info(app.config.b.msg + " (stop)");
    next();
  }
};

// Application's entry point.
function main() {
  var app = exapp({
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


Utility Functions
-----------------

The following utility functions are exported by exapp.js:

  - `exapp.parseArguments(argv, start = 2)` - Parse an application's arguments from `argv` into a dictionary. For example the following array `["node", "app.js", "--key=value"]` would be parsed to `{ key: "value" }`.

  - `exapp.modularize(opt)` - Modularize a module or a class (that has to be instantiated) with `config`. This function is described in a separate section `Modularize`.


Modularize
----------

The exapp.js architecture has been designed to make maintaining and writing application's modules easier. It would be annoying to wrap every module or class into an object that is compatible with exapp.js interface. Also, sometimes the application wants to use the same module more than once. The `exapp.modularize(opt)` function was designed to solve this problem.

The `opt` parameter may contain the following:
  - `module` - Module or class to be instantiated (by using `new` operator) or by calling `module.new()`, which has a priority over using `new` operator (mandatory).
  - `as`     - Key in `app` to store the instantiated module to. If `as` is not present `name` will be used instead (optional).
  - `name`   - Module name, if not specified `module.name` would be used (optional).
  - `deps`   - Module dependencies, added to possible deps specified by `module` (optional).
  - `config` - Module configuration, passed to the module constructor (mandatory).

This means that instead of exporting an exapp.js compatible interface, exapp modules can just export a class to be instantiated or a module containing "new" function, that will return the instantiated module. This has several advantages:

  - Module can be a JS class that implements some basics (start / end).
  - Modules don't have to depend on exapp, the only requirement is to store the `app` object as "app" in the instantiated module.
  - It's possible to implement a complex logic that will instantiate a module based on the configuration. For example a DB driver can instantiate a DB specific driver based on the configuration.

Here is a following example that uses `modularize` (two files):

```js
// ---------------------------------------------------------------------------
// FILE: module.js
// ---------------------------------------------------------------------------

// Use `exclass` to create a JS class.
var exclass = require("exclass");

// A module class - object oriented way of creating your own modules. The
// framework doesn't dictate how to do such class, the only important thing
// to do is to backlink the `app` object in the module itself, so the module
// can access the `app` at any time.
var Module = exclass({
  $construct: function(app, config) {
    // Backlink the `app` within the module.
    this.app = app;

    // Some members...
    this.started = false;
  },

  // Module start handler.
  start: function(next) {
    this.started = true;
    this.app.silly("[MOD] Module.start() - called");

    next();
  },

  // Module stop handler.
  stop: function(next) {
    this.started = false;
    this.app.silly("[MOD] Module.stop() - called");

    next();
  }

  // Any other members...?
});
module.exports = Module;

// ---------------------------------------------------------------------------
// FILE main.js
// ---------------------------------------------------------------------------

var exapp = require("exapp");
var util = require("util");
var Module = require("./module");

// A console logger.
var ConsoleLogger = {
  log: function(level, msg /*, ... */) {
    var s = "[" + level + "] " +
        util.format.apply(null, Array.prototype.slice.call(arguments, 1));
    console.log(s);
  }
};

function main() {
  var app = exapp({
    logger: ConsoleLogger,
    config: {
      module: {} // Module configuration (if needed)
    }
  });

  // This is a modularized `Module`, accessible as "module" and using config
  // key "module".
  app.register(exapp.modularize({ module: Module, as: "module", config: "module" }));

  // Start the app.
  app.start(["*"], function(err) {
    // Nothing to do, just stop now after it started.
    app.stop(function(err) {
    });
  });
}

main();
```

The example should be self-explanatory.


Using Priority to Bootstrap the Application
-------------------------------------------

Bootstrapping is a very challenging task. How to do it without quirks in your application? Well, you can do it with exapp.js by taking advantage of module priorities. Let's consider that we have the following modules:

  * `db` - This is a module responsible for establishing a DB connection in `start()` handler and closing it in `stop()` handler.
  * `bo` - This is your business object that is using `db` in some way. It expects your database to be working and already bootstrapped.

It's obvious that `bo` depends on `db`. When the application is started it will first start `db` and then `bo`. Priority can be used to put something in the middle in case it's necessary. The following code should demonstrate how this will work:

```js
var exapp = require("exapp");
var util = require("util");

// Bootstrap module.
var BootstrapModule = {
  name: "bootstrap",

  deps: ["db"],
  priority: -1,

  // Bootstrap needs just `start()` handler
  start: function(app, next) {
    app.silly("Wiping out your DB!");

    // ... your bootstrap code ...

    next();
  }
};

function main(argv) {
  var app = exapp({
    logger: ConsoleLogger,
    config: {}
  });

  // Register modules. Again, exapp.js doesn't dictate where to look for a modules
  // to be registered. This is just an example. You can use something like
  // `index.js` to load and return all modules in a directory, etc...
  app.register([
    DBModule, // Has to be provided by you!
    BOModule  // Has to be provided by you!
  ]);

  // If the application has been started with "--bootstrap", insert the module.
  if (argv.indexOf("--bootstrap") !== -1)
    app.register(BootstrapModule)

  // Passing "*" guarantees bootstrap to be called - after "db" and before "bo".
  app.start(["*"], function(err) {
    // ... your on-start code ...

    app.stop(function(err) {
      // ... your on-stop code ...
    });
  });
}

main(process.argv);
```

License
-------

exapp.js has been released into the public domain, [see unlicense.org](http://unlicense.org/).
