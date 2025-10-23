
window['GL'] = null;
window['EXT_FLOAT'] = null;
window['EXT_LINEAR_FLOAT'] = null;


const Context = (function() {
  let _cv = null;
  let _cvWidth = -1, _cvHeight = -1;


  function init_all(){
    VBO.init();
    FBO.init();
    Shaders.init();
    Texture.init();
  }


  function get_GLExtension(ext){
    return GL.getExtension(ext) ||
        GL.getExtension('OES_' + ext) ||
        GL.getExtension('MOZ_OES_' + ext) ||
        GL.getExtension('WEBKIT_OES_' + ext);
  }


  function log_consoleWithTimestamp(msg){
    const time = new Date().toISOString()
    console.log(msg + ' (at ' + time + ')')
  }


  const that = {
    set_size: function(s){
      _cv['width'] = s,
      _cv['height'] = s,
      _cvWidth = s,
      _cvHeight = s;
    },


    get_width: function() {
      return _cv['width'];
    },


    get_height: function() {
      return _cv['height'];
    },


    resize_canvas: function(w, h) {
      _cv['width'] = w;
      _cv['height'] = h;
    },


    save_canvasSize: function() {
      _cvWidth = _cv['width'];
      _cvHeight = _cv['height'];
    },


    restore_canvasSize: function() {
      that.resize_canvas(_cvWidth, _cvHeight);
    },


    get_cv: function() {
      return _cv;
    },


    set_GLState: function(){
      GL.clearColor(0, 0, 0, 0);

      // disable all this fucking gamer stuffs:
      GL.disable(GL['DEPTH_TEST']);
      GL.disable(GL['BLEND']);
      GL.disable(GL['DITHER']);
      GL.disable(GL['STENCIL_TEST']);
      GL.disable(GL['CULL_FACE']);
      
      GL.disable(GL['SAMPLE_ALPHA_TO_COVERAGE']);
      GL.disable(GL['SAMPLE_COVERAGE']);

      if (GL['GENERATE_MIPMAP_HINT']){ // high precision mipmap gen
        //GL['hint'](GL['GENERATE_MIPMAP_HINT'], GL['NICEST']);

        // 2025-10-25 - from trainer 1.5.2 - GL.NICEST most may use more complicated filter than box filter
        // so the mipmap computation may not match the mean
        GL['hint'](GL['GENERATE_MIPMAP_HINT'], GL['FASTEST']);
      }
    },


    init: function(specArg) {
      const spec = Object.assign({
        onContextLost: null
      }, specArg || {});      

      // get or create canvas:
      _cv = spec.canvas || document.getElementById('resultLiveCanvas');
      if (!_cv) {
        _cv = document.createElement('canvas');
        _cv.width = 512;
        _cv.height = 512;
      }

      // init WebGL context:
      GL = _cv.getContext("webgl", {
        'antialias': false,
        'alpha': true,
        'preserveDrawingBuffer': true,
        'premultipliedAlpha': false,
        'stencil': false,
        'depth': true
      });

      // handle context loss:
      _cv.addEventListener('webglcontextlost', function(e){
        log_consoleWithTimestamp('ERROR in Context.js: WEBGL CONTEXT LOST');
        if (spec.onContextLost){
          spec.onContextLost(e);
        }
      }, false);
      
      // INIT EXTENSIONS:
      
      // enable texture float:
      window['EXT_FLOAT'] = get_GLExtension('texture_float');

      // enable texture float linear (mipmap and texture repeat on float texture):
      window['EXT_LINEAR_FLOAT'] = get_GLExtension('texture_float_linear');

      if (!window['EXT_FLOAT'] || !window['EXT_LINEAR_FLOAT']){
        return false;
      }

      // render to depth texture is used in FaceDetectionTrainer for faceDepth:
      window['EXT_DEPTH_TEXTURE'] = get_GLExtension('WEBGL_depth_texture');

      // avoid a warning on FF:
      window['EXT_COLOR_BUFFER_FLOAT'] = get_GLExtension('WEBGL_color_buffer_float');

      that.set_GLState();
      init_all();

      return true;
    } //end init()
  }; //end that
  return that;
})();
