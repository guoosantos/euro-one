export function waitForMapContainerReady(
  containerEl,
  { minWidth = 300, minHeight = 300, maxFrames = 60 } = {},
) {
  return new Promise((resolve) => {
    if (!containerEl) {
      resolve(false);
      return;
    }

    let lastRect = null;
    let stableFrames = 0;
    let frame = 0;

    const check = () => {
      frame += 1;
      if (!containerEl || frame > maxFrames) {
        resolve(false);
        return;
      }

      const rect = containerEl.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const meetsMinimums = width >= minWidth && height >= minHeight;

      if (lastRect && lastRect.width === width && lastRect.height === height) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      lastRect = { width, height };

      if (meetsMinimums && stableFrames >= 2) {
        resolve(true);
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

export class MapLifecycleController {
  constructor(options = {}) {
    this.options = options;
    this.map = null;
    this.container = null;
    this.active = false;
    this.timeoutIds = [];
  }

  attach({ map, container }) {
    this.detach();
    if (!map) return;

    this.map = map;
    this.container = container || map.getContainer?.() || null;
    this.active = true;

    const run = () => {
      if (!this.active) return;
      waitForMapContainerReady(this.container, this.options).then((ready) => {
        if (!this.active || !ready) return;
        this.invalidateSequence();
      });
    };

    if (map._loaded) {
      run();
    } else if (map.whenReady) {
      map.whenReady(run);
    } else {
      run();
    }
  }

  invalidateSequence() {
    const map = this.map;
    if (!map?.invalidateSize) return;

    map.invalidateSize({ pan: false });
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));

    this.timeoutIds.push(
      setTimeout(() => map.invalidateSize({ pan: false }), 200),
      setTimeout(() => map.invalidateSize({ pan: false }), 600),
    );
  }

  refresh() {
    if (!this.active) return;
    this.invalidateSequence();
  }

  detach() {
    this.active = false;
    this.timeoutIds.forEach((id) => clearTimeout(id));
    this.timeoutIds = [];
  }
}
