import Effect, { ConfigUI, fract } from './effect';
import { parseHtml } from '../ui/util';
import { ImageCapture } from 'image-capture/lib/imagecapture';

const EffectName = 'Webcam';
const EffectDescription = 'Make use of the user\'s webcam as the particles\' color values';

class WebcamConfigUI extends ConfigUI {
  constructor() {
    super();
    const classPrefix = 'effect-webcam';
    this.element = parseHtml(`
      <fieldset>
        <legend>${EffectName}</legend>
        Especially in Firefox, it is sometimes necessary to wait some time
        before webcam images can be retrieved. It may also be helpful to
        retry connecting to the webcam several times.
        <br />
        <label>
          Max number of retries:
          <input type="number" min="0" max="10" step="1" value="3" class="${classPrefix}-retries" />
        </label>
        <br/>
        <label>
          Delay between retries:
          <input type="number" min="0" max="10000" step="1" value="400" class="${classPrefix}-retry-timeout" />ms
        </label>
      </fieldset>
    `);
    const ui = this.element;
    this.maxRetriesInput = ui.querySelector(`.${classPrefix}-retries`);
    this.retryTimeoutInput = ui.querySelector(`.${classPrefix}-retry-timeout`);

    this.maxRetriesInput.addEventListener('change', () => {
      this.notifyChange();
    });
    this.retryTimeoutInput.addEventListener('change', () => {
      this.notifyChange();
    });
  }

  getElement() {
    return this.element;
  }

  getConfig() {
    return {
      maxRetries: parseInt(this.maxRetriesInput.value, 10),
      retryTimeout: parseInt(this.retryTimeoutInput.value, 10)
    };
  }

  applyConfig(config) {
    this.maxRetriesInput.value = config.maxRetries || 0;
    this.retryTimeoutInput.value = config.retryTimeout || 400;
  }
}

export default class WebcamEffect extends Effect {
  static registerAsync(instance, props) {
    // State variables
    const canvas = document.createElement('canvas');
    let stream = null;
    let stopped = false;
    const stop = () => { stopped = true; };
    const isActive = () => {
      const clock = props.clock;
      const time = clock.getTime();
      return !clock.isPaused() && instance.timeBegin <= time && time <= instance.timeEnd;
    };

    // Shutdown hook
    props.state.addHook(() => {
      stop();
      // FIXME understand and document when this can happen.
      // E.g. when the getUserMedia() request is ignored in icognito
      // mode
      if (stream !== null) {
        const allTracks = stream.getTracks();
        for (let i = 0; i < allTracks.length; i++) {
          allTracks[i].stop();
        }
      }
    });

    const mediaConstraints = {
      audio: false,
      video: true // we want video
    };
    // Let's ask the browser if we can haz video
    return navigator.mediaDevices.getUserMedia(mediaConstraints)
    .then((theStream) => {
      stream = theStream;
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) {
        return Promise.reject('No video tracks in user media');
      }
      // We got a video feed!
      // Let's try to adapt it to our needs a little bit more
      const videoTrack = videoTracks[0];
      const constraints = {
        width: props.state.getWidth(),
        height: props.state.getHeight(),
        aspectRatio: props.state.getWidth() / props.state.getHeight(),
        facingMode: 'user'
      };
      // According to MDN, this shouldn't ever reject.
      // TODO maybe add an assertion for that
      return videoTrack.applyConstraints(constraints)
        .then(() => Promise.resolve(videoTrack), (err) => Promise.reject(err));
    }, (err) => Promise.reject(err))
    .then((videoTrack) => {
      // Now this is where the magic happens
      const capture = new ImageCapture(videoTrack);
      let retries = 0;
      const grabLoop = (imageOrTimestamp) => {
        if (isActive() && imageOrTimestamp && (typeof imageOrTimestamp) !== 'number') {
          const image = imageOrTimestamp;
          const w = image.width;
          const h = image.height;
          // FIXME the camera resolution shouldn't change all that often
          //       Maybe we can do this only once. Or we keep relying on
          //       the browser to optimize.
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.scale(-1, -1);
          ctx.drawImage(image, 0, 0, -w, -h);
          const pd = props.state.createParticleData(canvas, 'fit-image', {x: 'crop-both', y: 'crop-both'});
          props.state.setParticleData(pd);
        }
        if (!stopped) {
          // FIXME if we don't grab frames, Chrome will soon make the
          // track invalid, causing the next grabFrame to throw an error
          if (true || isActive()) {
            capture.grabFrame()
            .then(grabLoop, (err) => {
              // FIXME Firefox needs some time to get ready for grabbing
              // frames, so let's try this one more time if the first
              // one didn't succeed
              if (retries < instance.config.maxRetries) {
                retries = retries + 1;
                window.setTimeout(() => grabLoop(0), instance.config.retryTimeout);
              } else {
                // Throw the error from outside any promises
                window.setTimeout(() => { throw err; }, 0);
              }
            });
          } else {
            window.requestAnimationFrame(grabLoop);
          }
        }
      };
      // start grabbing images!
      window.requestAnimationFrame(grabLoop);
    }, (err) => Promise.reject(err));
  }

  static getDisplayName() {
    return EffectName;
  }

  static getDescription() {
    return EffectDescription;
  }

  static getConfigUI() {
    if (!this._configUI) {
      this._configUI = new WebcamConfigUI();
    }

    return this._configUI;
  }

  static getDefaultConfig() {
    return {};
  }

  static getRandomConfig() {
    return {};
  }
}
