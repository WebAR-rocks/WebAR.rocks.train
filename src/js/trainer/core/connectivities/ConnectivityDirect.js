/*
 * construct new connectivity
 * 
 * Connectivity between 2 layers
 * this kind of connectivity only works with layers of the same size !
 * 
 * _spec:
 *  <int> fromLayerSize: size of the top NeuronLayer
 *  <int> toLayerSize: size of the bottom neuron layer
 *  <int> toSparsity: sparsity from the toLayer POV
 *  <bool> debug: boolean
 *  <object> backup: backup of the connectivity
 *  <bool> initToZero: if true, init weights to 0 (default: false)
 *  
 * 
 */
const ConnectivityDirect = (function() {

  const __defaultSpec = {
    'fromLayerSize': -1,
    'toLayerSize': -1,
    initToZero: false,
    backup: null
  };

  return {
    instance: function(spec) {

      // compute and check parameters:
      const _spec = Object.assign({}, __defaultSpec, spec);

      //PRECOMPILER_BEGINLOG
      if (_spec['fromLayerSize'] !== _spec['toLayerSize']){
        console.log('WARNING in ConnectivityDirect - instance: the 2 layers do not have the same size. Please use other kind of connectivity ._spec=', _spec);
      }
      console.log('DEBUG in ConnectivityDirect - instance: _spec = ', _spec);
      //PRECOMPILER_ENDLOG


      const _size = _spec['fromLayerSize'];
      

      // BUILD THE TEXTURES:
      const _textures = {
        weights: null,
        updatedWeights: null,
        bpWeightsDeltas: null
      }

      // this texture store the weights as a list
      if (_spec.backup) {
        _textures.weights = Texture.instance(_spec.backup['weights']);
      } else {
        _textures.weights = Texture.instance({
          'isFloat': true,
          'isPot': true,
          'width': _size,
          isRandom: (_spec.initToZero) ? false : true,
          mean: 0,
          deviation: 1 / _spec.toSparsity
        });

        if (_spec.initToZero){
          _textures.weights.fill_uniformColor(0);
        }
      }

      _textures.updatedWeights = Texture.instance({
        'isFloat': true,
        'isPot': true,
        'width': _size
      });

      _textures.bpWeightsDeltas = Texture.instance({
        'isFloat': true,
        'isPot': true,
        'width': _size,
        'isMipmap': true
      });
      

      const that = {
        shouldSumFF: true, // if we need to sum after the draw_FF operation

        // GETTERS:

        get_fromSparsity: function() {
          return 1;
        },

        get_weights: function() {
          return _textures.weights;
        },

        get_bpWeightsDeltasTexture: function() {
          return _textures.bpWeightsDeltas;
        },

        get_updatedWeightsTexture: function() {
          return _textures.updatedWeights;
        },

        export_toJSON: function() {
          return {
            'fromLayerSize': _size, // size of the top NeuronLayer
            'toLayerSize': _size, // size of the bottom neuron layer
            'toSparsity': 1, // sparsity from the toLayer POV
            'weightsFromTo': false,
            'fromBindings': false,
            'toBindings': false,
            'square': false,
            'weights': _textures.weights.export_toJSON()
          };
        },


        // DRAWING:

        // called by NeuronLayer.js - draw_feedforward
        // feed forward. The input texture must be bound on channel 0
        // and the _fboInput FBO is bound
        process_feedforward: function() {
          Shaders.set('shp_weightsDirect');
          _textures.weights.bind_toSampler(1);
          VBO.draw_quad(true);
        },


        process_backpropagation: function(deltas) {
          // compute weights * deltas
          // deltas of the next layer are bind on channel 0
          Shaders.set('shp_bpWeightsDeltasDirect');
          _textures.bpWeightsDeltas.set_asRenderTargetVp();
          _textures.weights.bind_toSampler(1);
          VBO.draw_quad(true);
          Texture.unbind(2);

          _textures.bpWeightsDeltas.bind_toSampler(0);
        }
      }; //end that;

      return that;
    } //end instance()

  };
})(); 
