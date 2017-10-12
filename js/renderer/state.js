import RendererPipeline from './pipeline';
import { ScalingInfo, mapImageToParticles } from './scaling';

function domImgToCanvas(img) {
  const fullresCanvas = document.createElement('canvas');
  const fullresContext = fullresCanvas.getContext('2d');
  fullresCanvas.width = img.naturalWidth;
  fullresCanvas.height = img.naturalHeight;
  // flipped y-axis
  fullresContext.translate(0, img.naturalHeight);
  fullresContext.scale(1, -1);
  fullresContext.drawImage(img, 0, 0);
  return fullresCanvas;
}

class ParticleData {
  constructor(imageData, regl, scalingInfo) {
    const w = scalingInfo.particleCounts.x || imageData.width;
    const h = scalingInfo.particleCounts.y || imageData.height;
    this.destroyed = false;
    
    const scaledData = mapImageToParticles(imageData, scalingInfo);

    const particlePixels = scaledData.data;

    const pixelIndices = Array.from(Array(w * h).keys());

    const texcoords = pixelIndices.map((i) => [((i % w) + 0.5) / w, (Math.floor(i / w) + 0.5) / h]);

    const rgb = pixelIndices.map((i) => {
      const pixel = particlePixels.slice(i * 4, (i * 4) + 4);

      return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
    });

    const hsv = pixelIndices.map((i) => {
      const pixel = rgb[i];

      const cMax = Math.max(pixel[0], pixel[1], pixel[2]);
      const cMin = Math.min(pixel[0], pixel[1], pixel[2]);
      const d = cMax - cMin;

      if (d < 0.00001 || cMax < 0.00001) {
        return [0, 0, cMax];
      }

      let _h;
      if (cMax === pixel[0]) {
        _h = (pixel[1] - pixel[2]) / d;
        if (_h < 0) {
          _h += 6;
        }
      } else if (cMax === pixel[1]) {
        _h = ((pixel[2] - pixel[0]) / d) + 2;
      } else {
        _h = ((pixel[0] - pixel[1]) / d) + 4;
      }

      return [_h * 60 * (Math.PI / 180), d / cMax, cMax];
    });
    this.width           = w;
    this.height          = h;
    this.texcoordsBuffer = regl.buffer(texcoords);
    this.rgbBuffer       = regl.buffer(rgb);
    this.hsvBuffer       = regl.buffer(hsv);
  }
  destroy() {
    if (!this.destroyed) {
      this.texcoordsBuffer.destroy();
      this.rgbBuffer.destroy();
      this.hsvBuffer.destroy();
      this.destroyed = true;
    }
  }
}

class ParticleDataStoreEntry {
  constructor(imageCanvas, imageScaling, imageCropping, particleData) {
    this.imageCanvas = imageCanvas || null;
    this.imageScaling = imageScaling;
    this.imageCropping = imageCropping;
    this.particleData = particleData || null;
  }
  destroy() {
    if (this.particleData !== null) {
      this.particleData.destroy();
      this.particleData = null;
    }
    this.imageCanvas = null;
  }
}

/**
 * Encapsulates the parts of the render pipeline which are subject to
 * dynamic change, i.e. data that can be changed by effects.
 * 
 * In contrast to this, data inside a `config` object is always immutable
 * (as long as the user does not request changes to be applied - which
 * generates a new `config` object).
 * The most important thing to note is that both `state` *and* `config`
 * objects "live on" if the other object is changed, whereas only `state`
 * is ever influenced by `config` - never the other way around.
 * E.g. config's xParticleCount influences state's particleData.
 * On the other hand, `state` does not need to be serializable
 */
export default class RendererState {
  constructor(regl) {
    this.regl = regl;
    this.pipeline = new RendererPipeline(regl);

    // Properties
    this.config = null;
    this.particleData = -1;
    this.particleDataStore = [new ParticleDataStoreEntry(null, '', {x: '', y: ''}, null)];
    this.buffers = [];
    this.hooks = [];
    this.width = 0;
    this.height = 0;
  }
  adaptToConfig(config) {
    this.config = config;
    this.pipeline.reset(config.backgroundColor);

    // Update default particle data
    const DPD = this.particleDataStore[0];
    const defaultImg = DPD.imageCanvas;
    if (defaultImg !== null) {
      const scalingInfo = new ScalingInfo(
        {x: config.xParticlesCount, y: config.yParticlesCount},
        DPD.imageScaling, DPD.imageCropping,
        {width: this.getWidth(), height: this.getHeight()}
      );
      DPD.destroy();
      this.particleDataStore[0] = new ParticleDataStoreEntry(
        defaultImg, scalingInfo.imageScaling, scalingInfo.imageCropping,
        new ParticleData(defaultImg, this.regl, scalingInfo)
      );
    }
    // release resources
    for (let i = 1; i < this.particleDataStore.length; i++) {
      this.particleDataStore[i].destroy();
    }
    this.particleDataStore.length = 1;
    this.particleData = 0;

    for (let i = 0; i < this.buffers.length; i++) {
      this.buffers[i].destroy();
    }
    this.buffers.length = 0;
    // run hooks
    for (let i = 0; i < this.hooks.length; i++) {
      this.hooks[i]();
    }
  }
  setParticleData(id) {
    this.particleData = id;
  }
  createParticleData(imgData, imageScaling, imageCropping) {
    if (!imageScaling) {
      console.warn('No imageScaling given. Falling back to default value');
      imageScaling = 'crop-to-viewport'
    }
    if (!imageCropping) {
      console.warn('No imageCropping given. Falling back to default value');
      imageCropping = {x: 'crop-both', y: 'crop-both'};
    }
    const scalingInfo = new ScalingInfo(
      {x: this.config.xParticlesCount, y: this.config.yParticlesCount},
      imageScaling, imageCropping,
      {width: this.getWidth(), height: this.getHeight()}
    );
    this.particleDataStore.push(new ParticleDataStoreEntry(
      imgData, imageScaling, imageCropping,
      new ParticleData(imgData, this.regl, scalingInfo)
    ));
    return this.particleDataStore.length - 1;
  }
  createParticleDataFromDomImg(domImg, imageScaling, imageCropping) {
    return this.createParticleData(domImgToCanvas(domImg), imageScaling, imageCropping);
  }
  destroyParticleData(id) {
    this.particleDataStore[id].destroy();
  }
  getCurrentParticleData() {
    if (this.particleData < 0) {
      return null;
    }
    return this.particleDataStore[this.particleData].particleData;
  }
  createBuffer(...args) {
    const buf = this.regl.buffer(...args);
    this.buffers.push(buf);
    return { id: this.buffers.length - 1, buffer: buf };
  }
  destroyBuffer(id) {
    if (id < 0 || id >= this.buffers.length) {
      throw new Error('Illegal buffer id given for destruction');
    }
    this.buffers[id].destroy();
    this.buffers.splice(id, 1);
  }
  isValid() {
    return this.particleData >= 0 && this.pipeline.isValid();
  }
  /// Sets the image, but will not change the current default particle
  /// data. Rebuilding the default particle data will only happen on
  /// adaptToConfig
  setDefaultDomImage(domImage, imageScaling, imageCropping) {
    const DefaultEntry = this.particleDataStore[0];
    DefaultEntry.imageCanvas = domImgToCanvas(domImage);
    DefaultEntry.imageScaling = imageScaling;
    DefaultEntry.imageCropping = imageCropping;
    this.particleData = 0;
  }
  /// Hooks are run after the state has adapted to a new config object
  addHook(hook) {
    this.hooks.push(hook);
  }
  /// Changes the viewport dimension
  /// Not to be confused with the particle grid size. See
  /// config.xParticlesCount and config.yParticlesCount for that
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.pipeline.resize(width, height);
  }
  /// @return viewport width
  getWidth() {
    return this.width;
  }
  /// @return viewport height
  getHeight() {
    return this.height;
  }
}
