"use strict";

var assert = require("assert");
var util = require("util");

var qapp = require("./qapp");

var ConsoleLogger = {
  log: function(level, msg /*, ... */) {
    var s = "[" + level + "] " +
        util.format.apply(null, Array.prototype.slice.call(arguments, 1));
    console.log(s);
  }
};
qapp.ConsoleLogger = ConsoleLogger;

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

describe("QApp", function() {
  it("should resolve dependencies of 'a' and 'b'", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_DepsOnA])
      .start(["a", "b"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should resolve dependencies of 'b' and 'a'", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, B_DepsOnA, A_NoDeps])
      .start(["b", "a"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should initialize only 'a'", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_NoDeps])
      .start(["a"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });

  it("should initialize only 'b'", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_NoDeps])
      .start(["b"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, 1);
        done();
      });
  });

  it("should initialize all '*'", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_DepsOnA])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should initialize only 'b' (with 'a' as a dependency)", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_DepsOnA])
      .start(["b"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 1);
        assert.strictEqual(app.b, 2);
        done();
      });
  });

  it("should fail to initialize modules depending on each other", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_DepsOnB, B_DepsOnA])
      .start(["*"], function(err) {
        assert(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });

  it("should fail to initialize modules having unknwon dependency", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([A_NoDeps, B_NoDeps])
      .start(["*"], function(err) {
        assert(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });


  it("should fail to initialize an unknown module", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, B_NoDeps])
      .start(["unknown"], function(err) {
        assert(err);
        assert.strictEqual(app.a, undefined);
        assert.strictEqual(app.b, undefined);
        done();
      });
  });

  it("should resolve correct order if module has a priority (-1)", function(done) {
    var app = qapp({ logger: ConsoleLogger })
      .register([Counter, A_NoDeps, C_NoDeps_PriorityMinusOne])
      .start(["*"], function(err) {
        assert.ifError(err);
        assert.strictEqual(app.a, 2);
        assert.strictEqual(app.c, 1);
        done();
      });
  });

  it("should resolve correct order if module has a priority (+1)", function(done) {
    var app = qapp({ logger: ConsoleLogger })
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

    var app = qapp({ logger: ConsoleLogger })
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

    var app = qapp({ logger: ConsoleLogger })
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
});
