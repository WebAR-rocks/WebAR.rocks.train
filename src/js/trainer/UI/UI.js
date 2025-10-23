/*
 * User interface
 * Parent and monitoring component
 * 
 */
const UI = (function() {
  const _channels = [
      [1, 0, 0, 0], // RED
      [0, 1, 0, 0], // GREEN
      [0, 0, 1, 0], // BLUE
      [0, 0, 0, 1]  // ALPHA
    ];
  let _jqStats = null;

  let _scale = 1,
    _offset = 0,
    _isAbs = false;

  const _selected = {
    texture: null,
    layer: null
  };

  let _previousSelectedTexture = null;
  let _isSelectedTextureFirstTimeDraw = true;

  let _jqTabLabels = null;


  function get_currentTrainer(){
    return Trainer.prototype.current;
  }


  function init_monitoringTabs(){
    _jqTabLabels = {
      "liveView": $('#liveViewTab'),
      "graphView": $('#graphViewTab'),
      "stats": $('#statsTab'),
      "test": $('#testTab') 
    };

    let selectedPrefix = '';

    const select_tab = function(prefixId) {
      if (prefixId === selectedPrefix) return;
      for (let tabKey in _jqTabLabels){
        const jqTabContent = $('#' + tabKey + 'TabContent');
        if (prefixId === tabKey){
          _jqTabLabels[tabKey].addClass('selectedTab');
          jqTabContent.show();
        } else {
          _jqTabLabels[tabKey].removeClass('selectedTab');
          jqTabContent.hide();
        }
      }
      selectedPrefix = prefixId;
    };

    $('#liveViewTab').click(select_tab.bind(null, 'liveView'));
    $('#graphViewTab').click(select_tab.bind(null, 'graphView'));
    $('#statsTab').click(select_tab.bind(null, 'stats'));
    $('#testTab').click(select_tab.bind(null, 'test'));
    select_tab('liveView');
  }


  function init_monitoringStats(){
    // STAT RESULT:
    _jqStats = {
      statResult_nMinibatchs: $('#statResult_nMinibatchs'),
      statResult_lastTest: $('#statResult_lastTest'),
      statResult_lastTestInfos: $('#statResult_lastTestInfos'),
      statResult_bestTest: $('#statResult_bestTest'),
      statResult_bestTestInfos: $('#statResult_bestTestInfos'),
      statResult_SGDLearningRate: $('#statResult_learningRate'),
      statResult_SGDLearningRateDecay: $('#statResult_learningRateDecay'),
      statResult_learningSpeed: $('#statResult_learningSpeed')
    };

    // download learningCurve button:
    $('#statResult_downloadLearningCurve').click(function(){
      const trainer = get_currentTrainer();
      if (!trainer){
        console.log('Run a training script before.');
        return;
      }
      const lc = trainer.get_learningCurves();
      const lcJson = JSON.stringify(lc);
      const fileName = "learningCurve_" + UICode.get_fileName() + '_' + lib_date.get_YYYYMMDD() + '.json';
      lib_ajax.download(lcJson, fileName);
    });
  }


  function init_monitoringLiveView(){
    // RGBA channels:
    $("input[name='resultRGBA']").change(function() {
      that.channel = _channels[parseInt(this.value)];
      UI.refresh_GPUView();
    });

    // RANGE SLIDER for live GPU view scale and offset:
    $('#resultScale').on('input', function() {
      _scale = Math.pow(10, parseFloat($(this).val()));
      console.log('DEBUG in UI.js - _scale = ', _scale);
      UI.refresh_GPUView();
    });
    $('#resultOffset').on('input', function() {
      const val = parseFloat($(this).val());
      _offset = (val === -3) ? 0 : Math.pow(10, val);
      console.log('DEBUG in UI.js - _offset = ', _offset);
      UI.refresh_GPUView();
    });
    $('#resultAbs').on('change', function(){
      _isAbs = $(this).get(0).checked;
      console.log('DEBUG in UI.js - _isAbs = ', _isAbs);
      UI.refresh_GPUView();
    })

    that.toggle_monitoringDataTexture(false);
  }


  function init_logger(){
    Logger.init({
      DOMSelector: '#Logger'
    });
    const trainerApp = Trainer['APP'] || 'NNGL';
    console.log('Welcome to ' + trainerApp + ' v' + Trainer['VERSION'] + ' Integrated Training Environment');
    console.log('Copyright (c) 2020 WebAR.rocks');
    Logger.log_rawText(`  ██╗    ██╗███████╗██████╗  █████╗ ██████╗           
  ██║    ██║██╔════╝██╔══██╗██╔══██╗██╔══██╗          
  ██║ █╗ ██║█████╗  ██████╔╝███████║██████╔╝          
  ██║███╗██║██╔══╝  ██╔══██╗██╔══██║██╔══██╗          
  ╚███╔███╔╝███████╗██████╔╝██║  ██║██║  ██║          
   ╚══╝╚══╝ ╚══════╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝          
             ██████╗  ██████╗  ██████╗██╗  ██╗███████╗
             ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██╔════╝
             ██████╔╝██║   ██║██║     █████╔╝ ███████╗
             ██╔══██╗██║   ██║██║     ██╔═██╗ ╚════██║
          ██╗██║  ██║╚██████╔╝╚██████╗██║  ██╗███████║
          ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝`);
    Logger.scroll_toLast();
  }


  function init_monitoring(){
    init_monitoringTabs();
    init_monitoringStats();
    init_monitoringLiveView();
  }


  const that = {
    // GETTERS:
    channel: _channels[0],

    // get the value of a radio button using its name:
    get_radioVal: function(radioName) {
      return $("input[name='" + radioName + "']:checked").val();
    },

    get_scale: function() {
      return _scale;
    },

    get_offset: function() {
      return _offset;
    },

    get_isAbs: function(){
      return _isAbs;
    },

    get_selectedTexture: function(){
      return _selected.texture;
    },


    // SETTERS:
    update_mbCounterAndSpeed: function(n, speed) {
      // do not update too often:
      if (n>100 && n%10!==0){
        return;
      }
      _jqStats.statResult_nMinibatchs.html(n);
      _jqStats.statResult_learningSpeed.html(speed.toFixed(2));
    },


    set_status: function(status) {
      UIControls.set_status(status);
    },


    set_lastTest: function(index, value) {
      _jqStats.statResult_lastTest.html(value.toFixed(6) + ' - test n°' + index);
    },


    set_bestTest: function(test) {
      _jqStats.statResult_bestTest.html(test.value.toFixed(6) + ' for test n°' + test.index);
    },


    toggle_running: function(isRunning){
      if (isRunning){
        $('#monitoringLoading').remove();
        $('.monitoringContent').removeClass('monitoringContent');
      }
      UICode.toggle_running(isRunning);
    },


    toggle_graphDisplay: function(isLiveDisplay){
      _jqTabLabels['graphView'].css('display', (isLiveDisplay) ? 'block' : 'none');
    },


    reset_stats: function() {
      for (let key in _jqStats) {
        _jqStats[key].html('');
      }
    },


    set_SGDLearningRate: function(lr) {
      let r = 'unknow type: ' + typeof(lr);
      switch (typeof(lr)) {
        case 'number':
        case 'string':
          r = lr;
          break;

        case 'object':
        case 'array':
          r = lr.join('<br/>\n');
          break;
      }
      _jqStats.statResult_SGDLearningRate.html(r);
    },


    set_SGDLearningRateDecay: function(lrd) {
      _jqStats.statResult_SGDLearningRateDecay.html(lrd.toFixed(8));
    },


    // init the UI:
    init: function() {

      // alert if leaving the page:
      $(window).bind('beforeunload', function() {
        return 'Are you sure you want to leave ?';
      });

      init_monitoring();
      init_logger();

      // Init sub components:
      UICode.init();
      UIControls.init();
    },


    refresh_GPUView: function() {
      if (!Trainer.is_pause()) return false;
      //console.log('INFO in UI: refresh_GPUView()');
      that.drawFS_selectedTexture();
      return true;
    },


    set_texturesMenu: function(problem, neuralNetwork, trainer){
      const jqMenu = $('#monitoringLayers');
      jqMenu.empty();

      // add problemProvider if necessary:
      const problemTextures = problem.get_displayableTextures();
      for (let label in problemTextures){
        that.create_jqTextureProviderItem('-2', label, problemTextures[label], false).appendTo(jqMenu);
      }
      
      // add trainer:
      if (trainer){
        const textures = trainer.get_displayableTextures();
        const label = 'Trainer';
        that.create_jqTextureProviderItem('-1', label, textures, false).appendTo(jqMenu);
      }

      // add layers:
      const layers = neuralNetwork.get_layers();
      const layersCount = layers.length;

      for (let layerIndex=0; layerIndex<layersCount; ++layerIndex){
        const layerIndexStr = layerIndex.toString();
      
        // layer type:
        let layerType = 'hidden';
        if (layerIndex === 0){
          layerType = 'input';
        } else if (layerIndex === layersCount - 1){
          layerType = 'output';
        }

        const layerLabel = 'LAYER ' + layerIndexStr + ' (' + layerType + ')';
        
        const textures = layers[layerIndex].get_displayableTextures();
      
        const isSelected = (layerIndex === 0);
        that.create_jqTextureProviderItem(layerIndexStr, layerLabel, textures, isSelected).appendTo(jqMenu);
      } //end loop over layers
    }, //end set_texturesMenu()


    create_jqTextureProviderItem: function(id, label, textures, isSelected){
      // DOM layer select item:
      const jqItem = $('<div>').addClass('monitoringLayer');

      // radio button:
      const jqRadio = $('<input>').attr('type', 'radio').attr('name', 'monitoringLayer').val(id).appendTo(jqItem);
      if (isSelected) { // select input layer:
        jqRadio.attr('checked', 'true');
      }

      // label:
      jqItem.append(label);

      // connect radio button:
      jqRadio.change(function() {
        if (!this.checked) return;
        UI.update_texturesMenu(textures);        
      });

      return jqItem;
    },


    update_texturesMenu: function(displayableTextures){
      const jqTextures = $('#monitoringTextures').empty();

      displayableTextures.forEach(function(texture, index) {
        if (!texture.texture){
          console.log('WARNING in UI.js - update_texturesMenu(): no texture provided for ' + texture.name);
          return;
        }

        // DOM texture select button:
        const jqElement = $('<div>').addClass('monitoringTexture').appendTo(jqTextures);

        // radio button:
        const jqRadio = $('<input>').attr('type', 'radio').attr('name', 'monitoringTexture').val(index).appendTo(jqElement);
        if (index === displayableTextures.length - 1) {
          // by default, select the last texture (likely the output texture)
          // when a user change the layer or at start
          jqRadio.attr('checked', 'true');
          that.select_texture(texture);
        }

        // add label:
        let label = texture.name;
        if (typeof(texture.texture) !== 'function'){
          label += ' (' + texture.texture.get_textSize() + ')';
        }
        jqElement.append(label);

        jqRadio.change(function() {
          if (!this.checked) return;
          that.select_texture(texture);
          UI.refresh_GPUView();
        });

      }); //end loop on displayable textures
      that.refresh_GPUView();
    }, //end update_texturesMenu()


    select_texture(texture){
      _selected.texture = texture;
      let isDataTexture = true;
      
      if (_selected.texture.renderingMode){
        const renderingMode = _selected.texture.renderingMode;
        switch(renderingMode){
          case 'color':
          case 'colored':
            isDataTexture = false;
            break;
        }
      }

      _selected.texture.isDataTexture = isDataTexture;
      _isSelectedTextureFirstTimeDraw = true;
      if (isDataTexture){
        that.toggle_monitoringDataTexture(true);
      } else {
        that.toggle_monitoringDataTexture(false);
      }
    },


    drawFS_selectedTexture: function() {
      // get texture:
      let selectedTexture = null;
      if (typeof(_selected.texture.texture) === 'function'){
        selectedTexture = _selected.texture.texture();
      } else {
        selectedTexture = _selected.texture.texture;
      }
      if (!selectedTexture){
        console.log('WARNING in UI - drawFS_selectedTexture(): Selected texture is null');
        return;
      }

      // log resolution:
      if (_isSelectedTextureFirstTimeDraw){
        _isSelectedTextureFirstTimeDraw = false;
        const w = selectedTexture.get_width();
        const h = selectedTexture.get_height();
        console.log('DEBUG in UI: Selected texture res = ' + w.toString() + ' x ' + h.toString());
      }

      const isArray = Array.isArray(selectedTexture);
      if (_previousSelectedTexture !== selectedTexture){
        const firstSelectedTexture = (isArray) ? selectedTexture[0] : selectedTexture;
        //console.log('INFO: Selected Texture resolution = ', firstSelectedTexture.get_width().toString() + '*' + firstSelectedTexture.get_height().toString());
        _previousSelectedTexture = selectedTexture;
      }

      // get rendering mode:
      const isColored = !_selected.texture.isDataTexture;
      
      // trigger rendering:
      if (isArray){
        // it is an array. draw each texture:
        FBO.unbindAndClear();
        GL.enable(GL.BLEND);
        GL.blendFunc(GL.SRC_ALPHA, GL.ONE);
        selectedTexture.forEach(function(selectedTex){
          selectedTex.draw_debug(isColored);
        });
        GL.disable(GL.BLEND);
        FBO.bind_default();
      } else {
        selectedTexture.draw_FS(isColored);
      }
    },


    toggle_monitoringDataTexture: function(isVisible){
      const jqMonitoringDataTexture = $('.monitoringDataTexture');
      if (isVisible){
        jqMonitoringDataTexture.show();
      } else {
        jqMonitoringDataTexture.hide();
      }
    },


    display_testsInfo: function(jqTarget, tests){
      if (!tests || tests.nFalsePositives === undefined){
        return false;
      }

      // Compute percentages:
      const detectionErrorsPerCent = lib_maths.get_percent(tests.nFalsePositives + tests.nFalseNegatives, tests.nTrials);
      const falsePositivesPercent = lib_maths.get_percent(tests.nFalsePositives, tests.nTrials);
      const falseNegativesPercent = lib_maths.get_percent(tests.nFalseNegatives, tests.nTrials);
      
      // Format displayed message:
      const displayFalsePosNegHTML = 'False + : ' + falsePositivesPercent + '%<br/>False - : ' + falseNegativesPercent + '%';
      const infosHTML = 'Detect errors: ' + detectionErrorsPerCent + '%<br/>' + displayFalsePosNegHTML;
      
      jqTarget.html(infosHTML);

      return true;
    },


    display_lastTestsInfo: function(tests){
      that.display_testsInfo(_jqStats.statResult_lastTestInfos, tests);
    },


    display_bestTestsInfo: function(tests){
      that.display_testsInfo(_jqStats.statResult_bestTestInfos, tests);
    }
  }; //end that
  return that;

})();