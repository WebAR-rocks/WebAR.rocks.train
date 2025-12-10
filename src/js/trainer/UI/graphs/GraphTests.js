/*
 * TEST MONITORING
 * 
 * Display 1 bar for each test
 * 
 * spec:
 *   - id: id of the div where to put the graph
 *   - width: width of the graph
 *   
 */

const GraphTests = (function() {
  function convert_colorFloatToHex(f){
    return Math.floor(f * 255).toString(16).padStart(2, '0');
  }


  function get_htmlBlue(lightness){ // blueRate = 0 -> black, 1 -> blue 100%
    const bHex = 'FF';
    const rgHex = convert_colorFloatToHex(lightness);
    return '#' + rgHex + rgHex + bHex; 
  }


  return {
    instance: function(spec) {
      const _spec = Object.assign({
        id: '',      // HTML id property of the container
        width: 256,  // width in pixels
        
        // not provided by the trainer:
        barWidth: 2,    // width of a bar in pixels
        height: 300,    // max height of a bar in pixels
        pointRadius: 1, // point radius in px,
        offsetX: 0,
      }, spec);
      
      // clean:
      const container = $('#' + _spec.id);
      container.empty();
      
      // setup canvas and 2d context:
      const _jqCv = $('<canvas>').prependTo(container);
      const _cv = _jqCv.get(0);
      
      _cv.width = _spec.width;
      _cv.height = _spec.height;
      
      const _ctx = _cv.getContext('2d');
      _ctx.lineWidth = _spec.barWidth;
      _ctx.font = '8pt Helvetica';
      
      let _posX = _spec.offsetX;
      
      // clear canvas:
      _ctx.fillStyle = '#dedede';
      _ctx.fillRect(0,0,_cv.width, _cv.height);
      let _lightness = 0;
      _ctx.fillStyle = get_htmlBlue(0); 
      
      // draw grid lines:
      _ctx.strokeStyle = '#888888';
      _ctx.lineWidth = 0.5;
      _ctx.beginPath();
      // hzt lines:
      for (let i=0; i<10; ++i){
        const y = Math.round(_spec.height*i/10);
        _ctx.moveTo(0,y);
        _ctx.lineTo(_spec.width, y);
      }
      // vt lines:
      for (let x=0; x<_spec.width; x+=10*_spec.barWidth){
        _ctx.moveTo(x,0);
        _ctx.lineTo(x, _spec.height);
      }
      _ctx.stroke();
      
      return {
        // update displayed data:
        update: function(successRate){
          const h = Math.round(successRate * _spec.height);
          // filled bars:
          //_ctx.fillRect(_posX, _spec.height-h, _spec.barWidth, h); // X, Y, W, H
          // points:
          // 1px width:
          //_ctx.fillRect(_posX, _spec.height-h, _spec.barWidth, 1); // X, Y, W, H
          // circular:
          _ctx.beginPath();
          _ctx.arc(_posX, _spec.height-h, _spec.pointRadius, 0, 2 * Math.PI);
          _ctx.fill();

          _posX += _spec.barWidth;
          if (_posX >= _spec.width - _spec.pointRadius){
            _posX = _spec.offsetX;
            _lightness = Math.min(1, _lightness + 0.3);
            _ctx.fillStyle = get_htmlBlue(_lightness); 
          }
        }
      };
    }, //end instance()
    
    // unit test - for debug only
    debug: function() {
    }
  };
})();

