import createRegl from 'regl';
import CommandBuilder from './command-builder';
import { Framebuffer, FullscreenRectCommand } from './regl-utils';

class RendererClock {
  constructor() {
    this.time = -1;
    this.delta = 0;
    this.absTime = Date.now();
    this.period = 1000;
    this.paused = false;
    this.wrapListeners = [];
  }
  frame() {
    if (this.paused || this.period === 0) {
      this.delta = 0;
      return;
    }
    if (this.time === -1) {
      // it was requested that we start at zero
      this.absTime = Date.now();
      this.time = 0;
    } else {
      const oldTime = this.absTime;
      this.absTime = Date.now();
      this.delta = this.absTime - oldTime;
      this.time += this.delta;
      while(this.time >= this.period) {
        this.time -= this.period;
        for (let i = 0; i < this.wrapListeners.length; i++) {
          window.setTimeout(() => this.wrapListeners[i](), 0);
        }
      }
    }
  }
  reset() {
    this.time = -1;
    this.delta = 0;
    this.absTime = Date.now();
  }
  setPeriod(p) {
    this.period = p;
  }
  getTime() {
    return this.time;
  }
  setTime(time) {
    this.time = time;
    this.delta = 0;
    this.absTime = Date.now();
  }
  getDelta() {
    return this.delta;
  }
  getAbsoluteTime() {
    return this.absTime;
  }
  setPaused(paused = true) {
    if (this.paused && !paused) {
      this.delta = 0;
      this.absTime = Date.now();
    }
    this.paused = paused;
  }
  getPaused() {
    return this.paused;
  }
  addWrapListener(listener) {
    this.wrapListeners.push(listener);
  }
  removeWrapListener(listener) {
    this.wrapListeners.splice(this.wrapListeners.indexOf(listener), 1);
  }
}

class ParticleData {
  constructor(imageData, regl, width, height) {
    this.destroyed = false;
    
    const scalingCanvas = document.createElement('canvas');
    const scalingContext = scalingCanvas.getContext('2d');
    scalingCanvas.width = width;
    scalingCanvas.height = height;
    scalingContext.drawImage(imageData, 0, 0, scalingCanvas.width, scalingCanvas.height);
    const scaledData = scalingContext.getImageData(0, 0, scalingCanvas.width, scalingCanvas.height);

    const w = scaledData.width;
    const h = scaledData.height;

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
    this.aspectRatio     = imageData.width / imageData.height;
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

class RenderFramebufferCommand extends FullscreenRectCommand {
  constructor() {
    super();
    this.frag = `
      precision highp float;
      uniform sampler2D texture;
      varying vec2 texcoord;
      void main() {
        vec3 color = texture2D(texture, texcoord).rgb;
        gl_FragColor = vec4(color, 1);
      }
    `;
    this.uniforms = {
      texture: (ctx, props) => props.texture
    };
  }
}

export class RendererPipeline {
  constructor(regl) {
    this.regl = regl;
    this.prePasses = [];
    this.mainCommand = null;
    this.postPasses = [];
    this.renderFramebufferCommand = regl(new RenderFramebufferCommand());
    this.framebuffer = null;
  }
  addPrePass(pass) {
    this.prePasses.push(pass);
  }
  addPostPass(pass) {
    this.postPasses.push(pass);
  }
  setMainCommand(cmd) {
    this.mainCommand = cmd;
  }
  reset(clearColor, framebuffer) {
    this.prePasses.length = 0;
    this.postPasses.length = 0;
    this.mainCommand = null;
    this.clearColor = clearColor;
    this.framebuffer = framebuffer;
  }
  run(props) {
    if (!this.mainCommand) {
      return;
    }
    for (let i = 0; i < this.prePasses.length; i++) {
      this.prePasses[i](props);
    }
    if (this.postPasses.length === 0) {
      this.regl.clear({ color: this.clearColor });
      this.mainCommand(props);
    } else {
      this.regl.clear({
        color: this.clearColor,
        framebuffer: this.framebuffer.framebuffer
      });
      // need to give the postPasses access to mainCommand output
      this.framebuffer.framebuffer.use(() => this.mainCommand(props));
      props.framebuffer = this.framebuffer;
      for (let i = 0; i < this.postPasses.length; i++) {
        let result = this.postPasses[i](props);
        if (result) {
          props.framebuffer = result;
        }
      }
      this.framebuffer = props.framebuffer;
      this.renderFramebufferCommand({ texture: this.framebuffer.texture });
    }
  }
  isValid() {
    return this.mainCommand !== null;
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
export class RendererState {
  constructor(regl) {
    this.regl = regl;
    this.pipeline = new RendererPipeline(regl);

    // Properties
    this.particleData = -1;
    this.particleDataStore = [[null, null]];
    this.unallocatedFramebuffers = [];
    this.allocatedFramebuffers = [];
    this.hooks = [];
    this.width = 1;
    this.height = 1;
  }
  adaptToConfig(config) {
    for (let i = 0; i < this.allocatedFramebuffers.length; i++) {
      this.unallocatedFramebuffers.push(this.allocatedFramebuffers[i]);
    }
    this.allocatedFramebuffers.length = 0;
    // We MUST release and re-set the pipeline's framebuffer, since
    // framebuffers are forwarded to/interchanged with postPasses.
    this.pipeline.reset(config.backgroundColor, this.acquireFramebuffer());

    // Update default particle data
    const defaultImg = this.particleDataStore[0][0];
    if (defaultImg !== null) {
      const defaultParticleData = this.particleDataStore[0][1];
      if (defaultParticleData !== null) {
        defaultParticleData.destroy();
      }
      this.particleDataStore[0][1] = new ParticleData(
        defaultImg,
        this.regl,
        config.xParticlesCount || defaultImg.width,
        config.yParticlesCount || defaultImg.height
      );
    }
    // release resources
    for (let i = 1; i < this.particleDataStore.length; i++) {
      this.destroyParticleData(i);
    }
    this.particleDataStore.length = 1;
    this.particleData = 0;
    // run hooks
    for (let i = 0; i < this.hooks.length; i++) {
      this.hooks[i]();
    }
  }
  setParticleData(id) {
    this.particleData = id;
  }
  createParticleData(imgData, width, height) {
    this.particleDataStore.push([
      imgData,
      new ParticleData(
        imgData,
        this.regl,
        width,
        height
      )
    ]);
    return this.particleDataStore.length - 1;
  }
  createParticleDataFromDomImg(domImg, width, height) {
    return this.createParticleData(domImgToCanvas(domImg), width, height);
  }
  destroyParticleData(id) {
    if (this.particleDataStore[id][1]) {
      this.particleDataStore[id][1].destroy();
      this.particleDataStore[id] = [null, null];
    }
  }
  acquireFramebuffer() {
    let buf = null;
    if (this.unallocatedFramebuffers.length === 0) {
      buf = new Framebuffer(this.regl);
      buf.resize(this.width, this.height);
    } else {
      buf = this.unallocatedFramebuffers.pop();
    }
    this.allocatedFramebuffers.push(buf);
    return buf;
  }
  releaseFramebuffer(buf) {
    const pos = this.allocatedFramebuffers.indexOf(buf);
    if (pos < 0) {
      throw new Error('Releasing non-allocated Framebuffer');
    }
    this.allocatedFramebuffers.splice(pos, 1);
    this.unallocatedFramebuffers.push(buf);
  }
  getCurrentParticleData() {
    if (this.particleData < 0) {
      return null;
    }
    return this.particleDataStore[this.particleData][1];
  }
  isValid() {
    return this.particleData >= 0 && this.pipeline.isValid();
  }
  setDefaultDomImage(domImage) {
    this.particleDataStore[0][0] = domImgToCanvas(domImage);
    this.particleData = 0;
  }
  addHook(hook) {
    this.hooks.push(hook);
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    for (let i = 0; i < this.allocatedFramebuffers.length; i++) {
      this.allocatedFramebuffers[i].resize(width, height);
    }
    // TODO should we also resize unallocated Framebuffers?
    // At least if size decreases?
    for (let i = 0; i < this.unallocatedFramebuffers.length; i++) {
      this.unallocatedFramebuffers[i].resize(width, height);
    }
  }
}

export default class Renderer {
  constructor(canvas) {
    this.regl = createRegl({ canvas });
    console.info(`max texture size: ${this.regl.limits.maxTextureSize}`);
    console.info(`point size dims: ${this.regl.limits.pointSizeDims[0]} ${this.regl.limits.pointSizeDims[1]}`);
    console.info(`max uniforms: ${this.regl.limits.maxVertexUniforms} ${this.regl.limits.maxFragmentUniforms}`);
    this.state = new RendererState(this.regl);
    this.config = null;
    this.commandBuilder = new CommandBuilder();
    this.clock = new RendererClock();
    this.regl.frame(() => {
      if (!this.state.isValid()) {
        return;
      }
      this.clock.frame();
      this.state.pipeline.run({
        config: this.config,
        state:  this.state,
        clock:  this.clock
      });
    });
  }

  resize(width, height) {
    this.state.resize(width, height);
  }

  getClock() {
    return this.clock;
  }

  setConfig(config) {
    this.config = config;
    // TODO: rebuild command only when necessary
    this.state.adaptToConfig(config);
    this.commandBuilder.buildCommand({
        config: this.config,
        state:  this.state,
        clock:  this.clock,
    })
    .then((command) => {
      this.clock.reset();
      this.clock.setPeriod(this.config.duration);
      this.state.pipeline.setMainCommand(this.regl(command));
    }, (error) => console.error(error));
  }

  getState() {
    return this.state;
  }
}
