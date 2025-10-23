/*
 * Train a neuron network
 * http://neuralnetworksanddeeplearning.com/chap2.html
 * 
 * _spec: as defined in the live code
 * 
 */

const Trainer = function(spec) {
  const _defaultSpec = {
    'enableUI': true,

    'problem': null,
    'network': null, // neural network instance
    
    'testsCount': 1000,
    'testMinibatchsInterval': 10000,
    'testFirst': false,

    'minibatchSize': 1, // number of training samples per minibatch
    'pauseAfterNTests': -1, // disabled
    'stopAfterMinibatchsCount': 0, // disabled
    'delayBetweenMinibatchs': 0, // in ms

    'cost': 'quadratic', // how deltas are computed

    // weights and biases decay:
    'l2Decay': 0,

    // SGD:
    'SGDLearningRate': -1,
    'SGDLearningRateFactor': 0.03, // as advised by Andrew Ng :)
    'SGDMomentum': 0,
    'SGDLearningRatePeriod': 0, // disabled if 0

    // monitoring:
    'display': false,
    'updateLiveDisplayMinibatchsInterval': 1,

    // misc:
    'log': null, // send ajax request to log learning
    'keepWebGLContextBusyAfterStop': false,

    // debug flags:
    debugOnlyFeedForward: false,
    debugNoLearning: false
  }

  const _spec = Object.assign({}, _defaultSpec, spec);

  // check specs:
  if (!_spec['network']){
    throw new Error('You should provide a neural network');
  }
  if (typeof(UI) === 'undefined'){
    _spec['enableUI'] = false;
  }
  if (!_spec['enableUI']){
    _spec['display'] = false;
  }

  // private variables declaration:
  const _learningCurves = {
    'successRates': [],
    'errors': []
  };

  const _counters = {
    minibatchs: 0,
    tests: 0
  };

  const _prevState = { // used to compute learning speed in img/s
    timestamp: -1,
    mbCount: -1
  };

  const _dims = {
    inputWidth: -1,
    outputWidth: -1
  };

  const _loading = {
    isLoaded: false,
    nToLoad: 2,
    nLoaded: 0,
    onloadedCallstack: []
  };

  const _learning = {
    l2Decay: -1,
    l2DecayApplied: null,
    rate: -1,
    rateDecay: 1,
    rateFactors: null
  };

  const _bestTest = {
    index: -1,
    value: 0
  };
  
  let _error0 = -1;

  const _graphDisplay = {
    enabled: false,
    component: null,
  };

  const _lastProcessedSample = {
    inputTexture: null,
    expectedTexture: null,
    deltaMaskTexture: null
  };

  const testInfoSchema = {
    'isValid': true,
    'index': -1,
    'error': 0,
    'successRate': 0
  };
  const _infos = {
    timestampStart: 0,
    learningSpeed: 0,
    lastTest: Object.assign({}, testInfoSchema),
    bestTest: Object.assign({}, testInfoSchema)
  };

  let _testDisplayComponent = null;
  
  const that = this;
  Trainer.prototype.current = this;

  _dims.inputWidth = _spec['network'].get_inputWidth();
  _dims.outputWidth = _spec['network'].get_outputWidth();
 
  
  // loading:
  function call_onload(func) {
    if (_loading.isLoaded) {
      func();
    } else {
      _loading.onloadedCallstack.push(func);
    }
  };


  function check_isLoaded() {
    ++_loading.nLoaded;

    //PRECOMPILER_BEGINLOG
    console.log('INFO in Trainer.js - check_isLoaded(): ', _loading.nLoaded, '/', _loading.nToLoad);
    //PRECOMPILER_ENDLOG
    if (_loading.nLoaded !== _loading.nToLoad) {
      return;
    }
    //PRECOMPILER_BEGINLOG
    console.log('INFO in Trainer.js - check_isLoaded: all input and expected output textures are loaded');
    //PRECOMPILER_ENDLOG

    // TEXTURES MENU:
    if (_spec['enableUI']){
      UI.set_texturesMenu(_spec['problem'], _spec['network'], that);
      const inputLayer = _spec['network'].get_inputLayer();
      UI.update_texturesMenu(inputLayer.get_displayableTextures());
    }

    _loading.isLoaded = true;
    _loading.onloadedCallstack.forEach(function(func) {
      func();
    });
    _loading.onloadedCallstack = [];
  };


  function lock_screenWake(){
    let wakeLock = null;
    const do_wakeLock = function(){
      navigator.wakeLock.request("screen")
        .then(function(wl){
          wakeLock = wl;
          console.log('INFO: Screen wake locked');
          wakeLock.addEventListener("release", function() {
            // triggered if the user changes active tab for example
            console.log('WARNING: The wake lock has been released')
          });
        })
    }

    try {
      do_wakeLock();
      document.addEventListener("visibilitychange", function() {
        if (wakeLock !== null && document.visibilityState === "visible") {
          // executed if the user return to the training browser tab for example
          do_wakeLock();
        }
      });
    } catch(err) {
      console.log('WARNING: Cannot lock screen wake');
    }
  }


  function update_learningSpeed(n){
    // compute and update speed in img / s:
    const ts = performance.now(); // timestamp in ms
    if (_prevState.timestamp !== -1){
      const dtSec = (ts - _prevState.timestamp) / 1000;
      const dImages = _spec['minibatchSize'] * (n - _prevState.mbCount);
      const speed = dImages / dtSec;
      _infos.learningSpeed = speed;
    }
    _prevState.timestamp = ts;
    _prevState.mbCount = n;
  };


  function copy_testResult(testResult, testResultInfo){
    testResultInfo['index'] = _counters.tests;
    testResultInfo['error'] = testResult.error;
    testResultInfo['successRate'] = testResult.successRate;
  };


  function start_keepWebGLContextBusyLoop(){
    console.log('INFO in Trainer.js: Start keeping WebGL Context busy to avoid context loss');
    keep_WebGLContextBusyIterate();
  };

  // keep webgl context busy:
  let _keepBusyTexture = null;
  if (_spec['keepWebGLContextBusyAfterStop']){
    _keepBusyTexture = Texture.instance({
      'width': 1,
    });
  }

  function keep_WebGLContextBusyIterate(){
    FBO.bind_default();
    Shaders.set('shp_debugUV');
    _keepBusyTexture.set_asRenderTargetVp();
    VBO.bind_quad();
    VBO.draw_quad(true);
    window.requestAnimationFrame(keep_WebGLContextBusyIterate)
  };


  _spec['network'].call_onload(check_isLoaded);

  _spec['problem'].init({
    glContext: GL,
    neuralNetwork: _spec['network'],
    inputWidth: _dims.inputWidth
  }).then(check_isLoaded);

  const _evaluator = Evaluator.instance(_spec['problem'].get_evaluationType());

  if (_spec['enableUI']){
    // MONITORING TEST TAB:
    _testDisplayComponent = GraphTests.instance({
      id: 'graphTests',
      width: 500
    });
  
    // MONITORING GRAPH TAB:
    if (_spec['display']) {
      _graphDisplay.enabled = true;

      if (_spec['problem'].can_displayGraphIdent()){
        _graphDisplay.component = GraphIdent.instance({
          id: 'graphClasses',
          width: 500,
          height: 300,
          size: _dims.outputWidth
        });
      } else if (_spec['problem'].can_displayGraphClass()) {
        _graphDisplay.component = GraphClasses.instance({
          id: 'graphClasses',
          width: 500,
          minibatchSize: _spec['minibatchSize'],
          classesCount: _spec['network'].get_classesCount()
        });
      } else {
        _graphDisplay.enabled = false;
      }
      UI.toggle_graphDisplay(_graphDisplay.enabled);
      
    } //end if display result
  } // end if UI enabled


  this.get_spec = function(){
    return _spec;
  }


  // SET L2 REGULARIZATION TERM:
  this.set_l2Decay = function(l2d) {
    switch (typeof l2d) {
      case 'array':
      case 'object':
        _learning.l2Decay = l2d;
        break;

      case 'number':
        _learning.l2Decay = lib_array.create(l2d, _spec['network'].get_numberLayers());
        break;

      default:
        //PRECOMPILER_BEGINLOG
        console.log('WARNING in Trainer.js: unknow type for l2Decay');
        //PRECOMPILER_ENDLOG
        break;
    }
  };


  // start the training:
  this['start'] = function() {
    if (Trainer.is_training()) {
      //PRECOMPILER_BEGINLOG
      console.log('ERROR in Trainer.js - start: there is already a running training session. Stop it before.');
      //PRECOMPILER_ENDLOG
      return false;
    }

    //PRECOMPILER_BEGINLOG
    console.log('INFO in Trainer.js - start()');
    //PRECOMPILER_ENDLOG

    Trainer.state = Trainer.states.loading;

    _counters.tests = 0;
    _prevState.timestamp = -1;
    _prevState.mbCount = 0;

    if (_spec['enableUI']){
      lock_screenWake();
      UI.reset_stats();
      UI.update_mbCounterAndSpeed(0, 1);
    }

    // LEARNING:
    switch (typeof(_spec['SGDLearningRate'])) {
      case 'number':
        _learning.rate = lib_array.create(_spec['SGDLearningRate'], _spec['network'].get_numberLayers());
        break;

      default:
        _learning.rate = _spec['SGDLearningRate'];
        break;
    }

    if (_spec['enableUI']){
      UI.set_SGDLearningRate(_learning.rate);
    }
    if (_spec['SGDMomentum'] !== 0){ // SGDMomentum gradient descent
      _spec['network'].set_SGDMomentum(_spec['SGDMomentum']);
    }

    _learning.rateFactors = lib_array.create(0, _learning.rate.length);

     that.set_l2Decay(_spec['l2Decay']);
    _learning.l2DecayApplied = lib_array.create(0, _learning.l2Decay.length);
    _counters.minibatchs = 0;

    // config:
    _spec['network'].build_output();
    _spec['network'].build_backPropagation();
    
    call_onload(function() {
      //PRECOMPILER_BEGINLOG
      console.log('INFO in Trainer.js - start()');
      //PRECOMPILER_ENDLOG

      _infos.timestampStart = lib_date.get_currentTimestamp();
      Trainer.state = Trainer.states.running;
      if (_spec['enableUI']){
        UI.toggle_running(true);
      }

      if (Trainer.onStart){
        Trainer.onStart();
      }
      
      that.resume();
    }); //end call_onload call
    return true;
  }; //end this.start()


  this.process_sample = function(shouldReturnCPUResult){
    // GET TRAINING SAMPLE:
    const trainingSample = _spec['problem'].generate_trainingSample(_counters.minibatchs);
    const expectedTexture = trainingSample.expected;
    const clampMaskTexture = trainingSample.clampMask || null;
    const signalTexture =  trainingSample.input;
    signalTexture.bind_toSampler(0);
   
    // save training sample for display:
    if (_spec['enableUI']){
      _lastProcessedSample.inputTexture = trainingSample.input;
      _lastProcessedSample.expectedTexture = trainingSample.expected;
      _lastProcessedSample.deltaMaskTexture = trainingSample.deltaMask;
    }    

    // FEEDFORWARD:
    const resultFeedforward = _spec['network'].process_feedforward(signalTexture, shouldReturnCPUResult, expectedTexture, clampMaskTexture);
    const returned = {
      resultFeedforward: resultFeedforward,
      sample: trainingSample
    };
    if (_spec.debugOnlyFeedForward) return returned;
    const outputTexture = _spec['network'].get_outputTexture();
   
    // BACKPROPAGATION:
    // build delta masks:
    let deltaMaskOutput = (trainingSample.deltaMask) ? trainingSample.deltaMask : null;
    deltaMaskOutput = deltaMaskOutput || _spec['problem'].compute_deltaMaskFromNNOutput(outputTexture);
    const deltaMasks = [];
    if (deltaMaskOutput) {
      deltaMasks.push(deltaMaskOutput);
    }
    // proceed backprop:
    _spec['network'].process_backpropagation(expectedTexture, deltaMasks, _spec['cost']);
    if (_spec.debugNoLearning) return returned;

    // LEARNING USING STOCHASTIC GRADIENT DESCENT:
    lib_array.scaleNew(_learning.rate, _learning.rateFactors, _spec['SGDLearningRateFactor'] * _learning.rateDecay);
    lib_array.scaleNew(_learning.l2Decay, _learning.l2DecayApplied, _learning.rateDecay);

    const learningMasks = false;
    _spec['network'].process_learning(_learning.rateFactors, _learning.l2DecayApplied, learningMasks);

    return returned;
  } //end process_sample()


  this.resume = function(isSingleStep){ // training loop
    if (!Trainer.is_running()){
      return;
    }

    let lastMinibatchSample = null;
    for (let mbi = 0; mbi < _spec['minibatchSize']; ++mbi) { // loop on minibatch elements
      lastMinibatchSample = that.process_sample((mbi === _spec['minibatchSize'] - 1));
    } //end minibatch loop

    if (_spec['SGDLearningRatePeriod']){
      that.update_learningRate();
    }

    // MONITORING LIVE GPU VIEW :
    if (_spec['enableUI']){
      that.update_UILive(lastMinibatchSample);
    }


    // TEST STAGE:
    const testCounterMinibatches = _spec['testFirst'] ? _counters.minibatchs : _counters.minibatchs + 1;
    if ( (testCounterMinibatches % _spec['testMinibatchsInterval']) === 0) {
      
      const testsResult = that.perform_test();

      // Update learning curve:
      _learningCurves['successRates'].push(testsResult.successRate);
      _learningCurves['errors'].push(testsResult.error); 

      // Update UI:
      that.update_lastTest(testsResult);
      that.update_bestTest(testsResult);

      //PRECOMPILER_BEGINDELETE
      // External log:
      that.log(testsResult.successRate);
      //PRECOMPILER_ENDDELETE

      if (_spec['pauseAfterNTests'] === _counters.tests) {
        Trainer.pause();
      }

      ++_counters.tests;
    }

    // display and increment minibatch:
    ++_counters.minibatchs;
    update_learningSpeed(_counters.minibatchs);
    if (_spec['enableUI']){
      UI.update_mbCounterAndSpeed(_counters.minibatchs, _infos.learningSpeed);
    }
    
    // next minibatch iteration:
    if (Trainer.is_running() && !isSingleStep){
      if(_spec['stopAfterMinibatchsCount'] && _counters.minibatchs > _spec['stopAfterMinibatchsCount']){
        Trainer.pause();
        Trainer.state = Trainer.states.finished;
        if (_spec['enableUI']){
          UI.set_status('finished');
        }
        if (_spec['keepWebGLContextBusyAfterStop']){
          start_keepWebGLContextBusyLoop();
        }
        //PRECOMPILER_BEGINLOG
        console.log('INFO in Trainer.js: FINISHED');
        //PRECOMPILER_ENDLOG
        if (Trainer.onEnd){
          Trainer.onEnd();
        }
      } else {
        window.requestAnimationFrame(function(){
          if (_spec['delayBetweenMinibatchs'] <= 0){
            that.resume();
          } else {
            setTimeout(that.resume, _spec['delayBetweenMinibatchs']);
          }
        });
      }
    }
  }; //end this.resume()


  this.update_learningRate = function(){
    const k = Math.log(2) / _spec['SGDLearningRatePeriod'];
    _learning.rateDecay = Math.exp(-k * _counters.minibatchs);
    if (_spec['enableUI']){
      UI.set_SGDLearningRateDecay(_learning.rateDecay);
    }
  }


  this.perform_test = function(){

    // perform a test over a test batch, not used by the training
    // this batch is the last provided batch:
    const testsResult = {
      nSuccess: 0,
      nTrials: 0,
      nTrialsConsidered: 0,
      nFalsePositives: 0,
      nFalseNegatives: 0,
      error: 0,
      isError: false,
      successRate: 0
    };

    if (_spec['enableUI']){
      Logger.begin_group();
    }

    testsResult.nTrials = (_spec['problem'].get_testsCount() === -1) ? _spec['testsCount'] : _spec['problem'].get_testsCount();
    
    let nErrorsSummed = 0;
    for (let testInd=0; testInd<testsResult.nTrials; ++testInd){
      
      const testedSample = _spec['problem'].generate_testingSample(testInd);
      testedSample.input.bind_toSampler(0);
      const expectedTexture = (_spec['problem'].needs_testSubstractExpectedTexture()) ? testedSample.expected : Texture.get_zero();
      const clampMaskTexture = testedSample.clampMask || null;
      const result = _spec['network'].process_feedforward(testedSample.input, true, expectedTexture, clampMaskTexture);
      
      // result equals <expected given texture, here T.get_zero()> - <output> = -<output>
      // so invert result:
      if (!_spec['problem'].needs_testSubstractExpectedTexture()){
        result.forEach(function(outputRGBA){
          outputRGBA[0] *= -1; // R
          outputRGBA[1] *= -1; // G
          outputRGBA[2] *= -1; // B
          outputRGBA[3] *= -1; // A
        });
      }
      const testedSampleResult = _spec['problem'].evaluate_test(result);
      
      if (testedSampleResult.isConsider){
        ++testsResult.nTrialsConsidered;
        switch(typeof(testedSampleResult.success)){
          case 'boolean':
            testsResult.nSuccess += (testedSampleResult.success) ? 1 : 0;
            break;
          case 'number':
            testsResult.nSuccess += testedSampleResult.success;
            break;
        } //end switch
        if (typeof(testedSampleResult.isFalsePositive) === 'boolean' && testedSampleResult.isFalsePositive){
          ++ testsResult.nFalsePositives;
        }
        if (typeof(testedSampleResult.isFalseNegative) === 'boolean' && testedSampleResult.isFalseNegative){
          ++ testsResult.nFalseNegatives;
        }
        if ('error' in testedSampleResult && testedSampleResult.error !== -Infinity){ // continuous cumulated error
          testsResult.error += testedSampleResult.error;
          testsResult.isError = true;
          ++nErrorsSummed;
        }
      } //end if should consider the test
    } //end loop on testInd

    if (_spec['enableUI']){
      Logger.end_group();
    }

    //PRECOMPILER_BEGINLOG
    console.log('INFO in Trainer - perform_test(): ', testsResult.nTrialsConsidered, 'trials have been considered');
    //PRECOMPILER_ENDLOG 

    if (testsResult.isError){
      testsResult.error /= nErrorsSummed;
    }
    testsResult.successRate = testsResult.nSuccess / testsResult.nTrialsConsidered
    return testsResult;
  } //end perform_test()


  this.update_UILive = function(lastMinibatchSample){
    UI.drawFS_selectedTexture(); // draw the selected texture in the viewport
    
    // MONITORING GRAPH VIEW:
    if ( _graphDisplay.enabled && (_counters.minibatchs % _spec['updateLiveDisplayMinibatchsInterval'] === 0)){

      if (_spec['problem'].can_displayGraphIdent()) {
        // result is the abs difference between the feedforward result and the expected result
        _graphDisplay.component.update(lastMinibatchSample.resultFeedforward);
      } else if (_spec['problem'].can_displayGraphClass()) {
        const expectedClassIndex = lastMinibatchSample.sample.expectedClassIndex;
        _graphDisplay.component.update(expectedClassIndex, lastMinibatchSample.resultFeedforward);
      }
    }
  }


  this.update_lastTest = function(testsResult){
    if (_spec['enableUI']){

      // Update Monitoring test tab:
      let testResultValDisplayed = -1;
      if (_evaluator.is_considerError()){
        if (_error0 === -1 && testsResult.isError){ // when display error, displays it relatively to error0
          _error0 = testsResult.error;
        }
        testResultValDisplayed = (testsResult.isError) ? (testsResult.error / _error0) : 1;
      } else {
        testResultValDisplayed = testsResult.successRate;
      }
      _testDisplayComponent.update(testResultValDisplayed);

      // Update Monitoring stats tab:
      const testResultVal = (testsResult.isError) ? testsResult.error : testsResult.successRate;
      UI.set_lastTest(_counters.tests, testResultVal);
      UI.display_lastTestsInfo(testsResult);
    }

    copy_testResult(testsResult, _infos.lastTest);
  }


  this.update_bestTest = function(testsResult){
    const testEvaluation = _evaluator.is_bestTest(testsResult);
    if (testEvaluation.isBest){
      _bestTest.value =  testEvaluation.value, _bestTest.index = _counters.tests;
      copy_testResult(testsResult, _infos.bestTest);
      if (_spec['enableUI']){
        UI.set_bestTest(_bestTest);
        UI.display_bestTestsInfo(testsResult);
      }
    }
  }


  this.export_toJSON = function(compressionSettings){
    const problemExportData = _spec['problem'].get_exportData();
    const trainerData = {
      'trainerApp': Trainer['APP'],
      'trainerVersion': Trainer['VERSION'],
      'trainingInfos': Trainer.get_infos()
    };
    let nn = _spec['network'].export_toJSON(problemExportData, trainerData);

    if (compressionSettings){
      nn = lib_compressNN.compress(nn, compressionSettings.level);
    }
    return nn;
  }


  //PRECOMPILER_BEGINDELETE
  this.log = function(successRate){
    if (!_spec['log']){
      return;
    }
    lib_ajax.get_json(
      _spec['log']['url'],
      function(response){
        console.log('TRAINER log - ', _spec['log']['url'], 'AJAX response: ', response);
      },
      {
        name: _spec['log']['name'],
        content: 'best for index ' + _bestTest.index + ': ' + _bestTest.val
      });
  }


  this.get_displayableTextures = function(){
    const displayableTextures = [{
        name: 'input',
        texture: function(){ return _lastProcessedSample.inputTexture; }
      }, {
        name: 'expected',
        texture: function(){ return _lastProcessedSample.expectedTexture; }
      }, {
        name: 'deltaMask',
        texture: function(){ return _lastProcessedSample.deltaMaskTexture; }
      }];
    return displayableTextures;
  }
  //PRECOMPILER_ENDDELETE

  this.get_learningCurves = function(){
    return _learningCurves;
  }

  this.get_minibatchsCount = function(){
    return _counters.minibatchs;
  }
  
  this.get_iterationsCount = function(){
    return (_counters.minibatchs * _spec['minibatchSize']);
  }

  this.get_learningSpeed = function(){
    return _infos.learningSpeed;
  }

  this.get_timestampStart = function(){
    return _infos.timestampStart;
  }

  this.get_progress = function(){
    return (_spec['stopAfterMinibatchsCount'] === 0) ? -1 
      : _counters.minibatchs / (_spec['stopAfterMinibatchsCount'] - 1)
  }

  this.get_lastTestInfo = function(){
    return _infos.lastTest;
  }

  this.get_bestTestInfo = function(){
    return _infos.bestTest;
  }
}; //end Trainer()



Trainer.prototype.current = null;



// STATIC PROPERTIES:

Trainer.states = {
  loading: -1,
  notLoaded: 0,
  running: 1,
  pause: 2,
  finished: 4
}
Trainer.state = Trainer.states.notLoaded;
Trainer.onStart = null;
Trainer.onEnd = null;


// STATIC METHODS:

Trainer.is_UIEnabled = function(){
  return (Trainer.prototype.current) ?
    Trainer.prototype.current.get_spec()['enableUI']
    : typeof(window['UI'] !== undefined);
}

Trainer.is_running = function() {
  return (Trainer.state === Trainer.states.running);
};


Trainer.is_pause = function() {
  return (Trainer.state === Trainer.states.pause);
};


Trainer.is_training = function(){
  return (Trainer.state === Trainer.states.pause || Trainer.state === Trainer.states.running);
};


Trainer.resume = function(){
  if (!Trainer.is_pause()) {
    return false;
  }
  Trainer.state = Trainer.states.running;
  //PRECOMPILER_BEGINLOG
  console.log('INFO in Trainer.js: RESUME');
  //PRECOMPILER_ENDLOG
  Trainer.prototype.current.resume();
  if (Trainer.is_UIEnabled()){
    UI.set_status('running...');
  }
  return true;
}


Trainer.train = function(trainingScriptSource){
  if (Trainer.is_running()){
    //PRECOMPILER_BEGINLOG
    console.log('INFO in Trainer.js: the code is already running. Do nothing.');
    //PRECOMPILER_ENDLOG
    return false;
  }
  if (Trainer.resume()){
    return true;
  }

  Trainer.state = Trainer.states.loading;
  //PRECOMPILER_BEGINLOG
  console.log('INFO in Trainer.js: start loading...');
  //PRECOMPILER_ENDLOG

  if (Trainer.is_UIEnabled()){
    UI.set_status('loading...');
  }
  
  try {
    eval.apply(window, [trainingScriptSource]); // eval code in the global context
  } catch(err) {
    console.log('ERROR: Cannot run the training script. Error =\n  ', (err || 'undefined'));
  }
  return true;
};


Trainer.pause = function(){
  if (!Trainer.is_running()){
    //PRECOMPILER_BEGINLOG
    console.log('INFO in Trainer.js: Nothing to pause.');
    //PRECOMPILER_ENDLOG
    return false;
  }

  Trainer.state = Trainer.states.pause;
  //PRECOMPILER_BEGINLOG
   console.log('INFO in Trainer.js: PAUSED');
  //PRECOMPILER_ENDLOG
  
  if (Trainer.is_UIEnabled()){
    UI.set_status('paused');
  }
  return true;
};


Trainer.error = function(){
  // called when context is lost for example
  Trainer.state = Trainer.states.error;
  if (Trainer.is_UIEnabled()){
    UI.set_status('error');
  }
  //PRECOMPILER_BEGINLOG
  console.log('INFO in Trainer.js: ERROR');
  //PRECOMPILER_ENDLOG
  return true;
};


Trainer.step = function(){
  if (!Trainer.is_running() && !Trainer.is_pause){
    return false;
  }
  if (Trainer.is_running()){
    Trainer.pause();
  }
  Trainer.state = Trainer.states.running;
  //PRECOMPILER_BEGINLOG
  console.log('INFO in Trainer.js: STEP');
  //PRECOMPILER_ENDLOG
  Trainer.prototype.current.resume(true);

  Trainer.pause();
  return true;
};


Trainer.init = function(){
  if (!Context.init({
      onContextLost: function(){
        //PRECOMPILER_BEGINLOG
        console.log('ERROR: WebGL Context Lost. Open chrome://gpu for more info');
        //PRECOMPILER_ENDLOG
        Trainer.error();
      }
    })){
      return false;
    };

  if (Trainer.is_UIEnabled()){
    UI.init();
  }

  return true;
};


Trainer.export_toJSON = function(compressionSettings){
  return (Trainer.prototype.current) ? Trainer.prototype.current.export_toJSON(compressionSettings) : null;
};


Trainer.get_infos = function(){

  // state label:
  const statesLabelMap = {};
  statesLabelMap[Trainer.states.notLoaded] = 'NOT_LOADED';
  statesLabelMap[Trainer.states.loading] = 'LOADING';
  statesLabelMap[Trainer.states.running] = 'RUNNING';
  statesLabelMap[Trainer.states.pause] = 'PAUSE';
  statesLabelMap[Trainer.states.finished] = 'FINISHED';
  
  // compute progress, speed, get learningCurve
  let progress = 0;
  let speed = 0;
  let iterationsCount = 0;
  let minibatchsCount = 0;
  let timestampStart = 0;
  let learningCurves = {
    'successRates': [],
    'errors': []
  };
  let lastTestResult = {'isValid': false};
  let bestTestResult = {'isValid': false};

  const currentTrainer = Trainer.prototype.current;
  if (currentTrainer){
    progress = currentTrainer.get_progress();
    speed = currentTrainer.get_learningSpeed();
    timestampStart = currentTrainer.get_timestampStart();
    minibatchsCount = currentTrainer.get_minibatchsCount();
    iterationsCount = currentTrainer.get_iterationsCount();
    learningCurves = currentTrainer.get_learningCurves();
    lastTestResult = currentTrainer.get_lastTestInfo();
    bestTestResult = currentTrainer.get_bestTestInfo();
  }

  const infos = {
    'state': statesLabelMap[Trainer.state],
    'progressPerCent': (progress === -1) ? -1 : lib_maths.reduce_significance(progress * 100, 2),
    'speed': lib_maths.reduce_significance(speed, 2),
    'timestampStart': timestampStart,
    'timestampCurrent': lib_date.get_currentTimestamp(),
    'iterationsCount': iterationsCount,
    'minibatchsCount': minibatchsCount,
    'learningCurves': learningCurves,
    'lastTestResult': lastTestResult,
    'bestTestResult': bestTestResult
  };

  return infos;
}

Trainer['APP'] = 'WebAR.rocks.train';
Trainer['VERSION'] = '1.0.1';
window['Trainer'] = Trainer;