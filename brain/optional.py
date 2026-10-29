# optional.py - load a feature's module that may be uninstalled (Settings -> Plugins removes its code files).
# load("missions") gives the real module, or a stand-in that does nothing, so the app still starts without it.
import importlib


class Missing:
    """stands in for an uninstalled feature's module: every attribute/call gives another Missing (falsy, empty)"""
    def __init__(self, name):
        self.__dict__["_name"] = name

    def __getattr__(self, key):
        if key.startswith("__"):
            raise AttributeError(key)
        return Missing(f"{self._name}.{key}")

    def __setattr__(self, key, value):        # e.g. missions.on_change = ...: ignored
        pass

    def __call__(self, *args, **kwargs):
        return self

    def __bool__(self):
        return False

    def __iter__(self):
        return iter(())

    def __len__(self):
        return 0

    def __repr__(self):
        return f"<{self._name}: not installed>"


def load(name):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as e:
        if e.name != name:                    # the module is there but something it needs isn't: a real error
            raise
        print(f"[optional] {name} isn't installed (Settings -> Plugins)")
        return Missing(name)
