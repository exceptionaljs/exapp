QApp
====

A lightweight application framework with dependency management

  * [Official Repository (jshq/qapp)](https://github.com/jshq/qapp)
  * [Unlicense] (http://unlicense.org)

QApp is a lightweight application framework that can be used to manage and maintain applications that require multiple modules that have dependencies. The framework itself defines a very slim interface. It contains an interface for logging, module management, and application's lifetime management. Everything else has to be provided by consumers (you).

The reason `qapp` has been developed is that sometimes your application is not just an `express()` object. Many node modules and applications just create `express()`, put some variables into it, and use as many globals they can in various modules for various purposes. The `qapp` philosophy is different - it tries to isolate everything within an `app` object/instance. It allows to define modules that can be started / stopped in correct order, and to let these modules share information they need through the `app` object. Every module can put its own information into `app` and other modules (that depend on it) can use it.
 
In addition, `qapp` allows to specify which modules to run. There are cases where one application instance runs only a subset of available modules. This is useful in cases that you want to share the whole code-base, but run several instances of your application having different configuration or different modules running.
