// exapp.js <https://github.com/exjs/exapp>
"use strict";

var assert = require("assert");
var util = require("util");

var exapp = require("./exapp");

var ConsoleLogger = {
  log: function(level, msg /*, ... */) {
    var s = "[" + level + "] " +
        util.format.apply(null, Array.prototype.slice.call(arguments, 1));
    console.log(s);
  }
};
exapp.ConsoleLogger = ConsoleLogger;

var Counter = {
  name: "counter",
  deps: [],
  start: function(app, next) {
    app.counter = 0;
    next(null);
  }
};

var A_NoDeps = {
  name: "a",
  deps: ["counter"],
  start: function(app, next) {
    app.a = ++app.counter;
    next(null);
  }
};

var B_NoDeps = {
  name: "b",
  deps: ["counter"],
  start: function(app, next) {
    app.b = ++app.counter;
    next(null);
  }
};

var A_DepsOnB = {
  name: "a",
  deps: ["counter", "b"],
  start: function(app, next) {
    app.a = ++app.counter;
    next(null);
  }
};

var B_DepsOnA = {
  name: "b",
  deps: ["counter", "a"],
  start: function(app, next) {
    app.b = ++app.counter;
    next(null);
  }
};

var C_NoDeps_PriorityMinusOne = {
  name: "c",
  deps: ["counter"],
  priority: -1,
  start: function(app, next) {
    app.c = ++app.counter;
    next(null);
  }
};

var C_NoDeps_PriorityPlusOne = {
  name: "c",
  deps: ["counter"],
  priority: 1,
  start: function(app, next) {
    app.c = ++app.counter;
    next(null);
  }
};

describe("exapp", function() {
  it("should test parseArguments()", function() {
    function check(argv, map) {
      assert.deepEqual(exapp.parseArguments(argv, 0), map);
      assert.deepEqual(exapp.parseArguments(["node", "app.js"].concat(argv)), map);
    }

    check([                             ], {                                 });

    check(["-a"                         ], { "-a": "true"                    });
    check(["-a", "-a"                   ], { "-a": "true"                    });
    check(["-a", "-b"                   ], { "-a": "true", "-b": "true"      });

    check(["-ab"                        ], { "-a": "true", "-b": "true"      });
    check(["-ab", "-a"                  ], { "-a": "true", "-b": "true"      });
    check(["-ab", "-b"                  ], { "-a": "true", "-b": "true"      });
    check(["-ab", "-a", "-b"            ], { "-a": "true", "-b": "true"      });

    check(["--a"                        ], { a: "true"                       });
    check(["--a", "--a"                 ], { a: "true"                       });
    check(["--a", "--a", "--a"          ], { a: "true"                       });

    check(["--a", "--b"                 ], { a: "true", b: "true"            });
    check(["--a", "--b", "--c"          ], { a: "true", b: "true", c: "true" });

    check(["--a="                       ], { a: ""                           });
    check(["--a=123456"                 ], { a: "123456"                     });
    check(["--a=string"                 ], { a: "string"                     });
    check(["--a=a", "--a=b"             ], { a: ["a", "b"]                   });
    check(["--a=a", "--a=b", "--a=c"    ], { a: ["a", "b", "c"]              });
    check(["--a=", "--a=a"              ], { a: ["", "a"]                    });
    check(["--a=a", "--a="              ], { a: ["a", ""]                    });
    check(["--hasOwnProperty=a"         ], { hasOwnProperty: "a"             });

    check(["--a", "123456"              ], { a: "123456"                     });
    check(["--a", "string"              ], { a: "string"                     });
    check(["--a", "a", "--a", "b"       ], { a: ["a", "b"]                   });
    check(["--a", "a", "--b", "b"       ], { a: "a", b: "b"                  });
    check(["--hasOwnProperty", "a"      ], { hasOwnProperty: "a"             });
  });

  it("should test application's properties", function(done) {
    var app = exapp({
      args: {},
      config: {},
      logger: ConsoleLogger
    });

    var knownProperties = [
      "args",
      "config",
      "logger",
      "state",
      "stopError",
      "stopOnFail"
    ];

    knownProperties.forEach(function(p) {
      assert.strictEqual(app.hasProperty(p), true);
    });

    assert.strictEqual(app.getProperty("args"), app.args);
    assert.strictEqual(app.getProperty("config"), app.config);
    assert.strictEqual(app.getProperty("logger"), app.logger);
    assert.strictEqual(app.getProperty("state"), app.getState());
    assert.strictEqual(app.getProperty("stopError"), null);
    assert.strictEqual(app.getProperty("stopOnFail"), false);

    app.setProperty("stopOnFail", true);
    assert.strictEqual(app.getProperty("stopOnFail"), true);

    app.setProperty("args", null);
    assert.strictEqual(app.args, null);

    app.setProperty("config", null);
    assert.strictEqual(app.config, null);

    app.setProperty("logger", null);
    assert.notStrictEqual(app.getProperty("logger"), ConsoleLogger);

    // State is a read-only property.
    assert.throws(function() {
      app.setProperty("state", exapp.kRunning);
    });

    done();
  });

  it("should resolve dependencies of 'a' and 'b'", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_DepsOnA])
      .start(["a", "b"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should resolve dependencies of 'b' and 'a'", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, B_DepsOnA, A_NoDeps])
      .start(["b", "a"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should initialize only 'a'", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_NoDeps])
      .start(["a"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });

  it("should initialize only 'b'", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_NoDeps])
      .start(["b"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, 1);
        done();
      });
  });

  it("should initialize all '*'", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_DepsOnA])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should initialize only 'b' (with 'a' as a dependency)", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_DepsOnA])
      .start(["b"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should fail to initialize modules depending on each other", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_DepsOnB, B_DepsOnA])
      .start(["*"], function(err) {
        assert(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });

  it("should fail to initialize modules having unknown dependency", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([A_NoDeps, B_NoDeps])
      .start(["*"], function(err) {
        assert(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });


  it("should fail to initialize an unknown module", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_NoDeps])
      .start(["unknown"], function(err) {
        assert(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });

  it("should resolve correct order if module has a priority (-1)", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, C_NoDeps_PriorityMinusOne])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 2);
        assert.strictEqual(app.c, 1);
        done();
      });
  });

  it("should resolve correct order if module has a priority (+1)", function(done) {
    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, C_NoDeps_PriorityPlusOne])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.c, 2);
        done();
      });
  });

  it("should catch exception thrown in module.start()", function(done) {
    var Throw = {
      name: "throw",
      deps: [],
      start: function(app, next) {
        throw new Error("Thrown within 'custom' module.");
      }
    };

    var app = exapp({ logger: ConsoleLogger })
      .register([Throw])
      .start(["throw"], function(err) {
        assert(err);
        assert.strictEqual(err.message, "Thrown within 'custom' module.");
        done();
      });
  });

  it("should stop in reverse order of initialization", function(done) {
    var CustomA = {
      name: "a",
      deps: ["counter"],
      start: function(app, next) {
        app.aStart = ++app.counter;
        next(null);
      },
      stop: function(app, next) {
        app.aStop = ++app.counter;
        next(null);
      }
    };

    var CustomB = {
      name: "b",
      deps: ["counter", "a"],
      start: function(app, next) {
        app.bStart = ++app.counter;
        next(null);
      },
      stop: function(app, next) {
        app.bStop = ++app.counter;
        next(null);
      }
    };

    var app = exapp({ logger: ConsoleLogger })
      .register([Counter, CustomA, CustomB])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.aStart, 1);
        assert.strictEqual(app.bStart, 2);

        app.stop(function(err) {
          assert.ifError(err);
          assert.strictEqual(app.bStop, 3);
          assert.strictEqual(app.aStop, 4);

          done();
        });
      });
  });

  it("should allow calling stop() if start fails", function(done) {
    var CustomA = {
      name: "a",
      deps: [],
      start: function(app, next) {
        app.aStarted = true;
        next(null);
      },
      stop: function(app, next) {
        app.aStopped = true;
        next(null);
      }
    };

    var CustomB = {
      name: "b",
      deps: ["a"],
      start: function(app, next) {
        app.bStarted = true;
        next(new Error("Expected failure"));
      },
      stop: function(app, next) {
        app.bStopped = true;
        next(null);
      }
    };

    var app = exapp({
      logger: ConsoleLogger,
      modules: [CustomA, CustomB]
    });

    app.start(["*"], function(err) {
      assert.notEqual(err, null);

      assert.strictEqual(app.aStarted, true);
      assert.strictEqual(app.bStarted, true);

      assert.strictEqual(app.bStopped, undefined);
      assert.strictEqual(app.aStopped, undefined);

      app.stop(function(err) {
        assert.ifError(err);

        assert.strictEqual(app.bStopped, undefined);
        assert.strictEqual(app.aStopped, true);

        done();
      });
    });
  });

  it("should automatically call stop if start fails (stopOnFail)", function(done) {
    var CustomA = {
      name: "a",
      deps: [],
      start: function(app, next) {
        app.aStarted = true;
        next(null);
      },
      stop: function(app, next) {
        app.aStopped = true;
        next(null);
      }
    };

    var CustomB = {
      name: "b",
      deps: ["a"],
      start: function(app, next) {
        app.bStarted = true;
        next(new Error("Expected failure"));
      },
      stop: function(app, next) {
        app.bStopped = true;
        next(null);
      }
    };

    var app = exapp({
      logger: ConsoleLogger,
      modules: [CustomA, CustomB],
      stopOnFail: true
    });

    app.start(["*"], function(err) {
      assert.notEqual(err, null);

      assert.strictEqual(app.aStarted, true);
      assert.strictEqual(app.bStarted, true);

      assert.strictEqual(app.bStopped, undefined);
      assert.strictEqual(app.aStopped, true);

      done();
    });
  });

  it("should call afterStart and afterStop handlers", function(done) {
    var Module = {
      name: "module",
      deps: [],
      start: function(app, next) {
        app.addHandler("afterStart", function(app) {
          assert.strictEqual(this, app);
          app.afterStartCalled = true;
        }, app /* check handler is called with correct `thisArg` if passed */);
        next(null);
      },
      stop: function(app, next) {
        app.addHandler("afterStop", function(app) {
          assert.strictEqual(this, app);
          app.afterStopCalled = true;
        }, app /* check handler is called with correct `thisArg` if passed  */);
        next(null);
      }
    };

    var app = exapp({ logger: ConsoleLogger })
      .register([Module])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.afterStartCalled, true);

        app.stop(function(err) {
          assert.ifError(err);
          assert.strictEqual(app.afterStopCalled, true);

          done();
        });
      });
  });

  it("should test exapp.modularize()", function(done) {
    function ModuleA(app, config) {
      this.app = app;
      this.config = config;
    };

    var aStatus = 0;
    var bStatus = 0;

    ModuleA.prototype.start = function(cb) {
      aStatus = 1;
      setImmediate(cb, null);
    };

    ModuleA.prototype.stop = function(cb) {
      aStatus = 2;
      setImmediate(cb, null);
    };

    function ModuleB(app, config) {
      this.app = app;
      this.config = config;
    };

    ModuleB.prototype.start = function(cb) {
      bStatus = 1;
      setImmediate(cb, null);
    };

    ModuleB.prototype.stop = function(cb) {
      bStatus = 2;
      setImmediate(cb, null);
    };

    ModuleB.deps = ["a"];

    var app = exapp({ logger: ConsoleLogger })
      .register([
        exapp.modularize({ module: ModuleA, name: "a" }),
        exapp.modularize({ module: ModuleB, name: "b" })
      ])
      .start(["*"], function(err) {
        assert.ifError(err);

        assert.strictEqual(typeof app.a, "object");
        assert.strictEqual(typeof app.b, "object");
        assert.strictEqual(aStatus, 1);
        assert.strictEqual(bStatus, 1);

        app.stop(function(err) {
          assert.ifError(err);

          assert.strictEqual(app.a, null);
          assert.strictEqual(app.b, null);
          assert.strictEqual(aStatus, 2);
          assert.strictEqual(bStatus, 2);

          done();
        });
      });
  });
});
