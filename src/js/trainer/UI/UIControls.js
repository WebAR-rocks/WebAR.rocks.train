const UIControls = (function() {
  let _jqButtons = null;
  let _jqStatus = null;

  function get_currentTrainer(){
    return Trainer.prototype.current;
  }


  function bind_jqButtons(){
    _jqButtons.run.click(function() {
      UICode.run();
      sync();
    });

    _jqButtons.pause.click(function() {
      Trainer.pause();
      sync();
    });

    _jqButtons.step.click(function() {
      Trainer.step();
    });

    _jqButtons.save.click(function() {
      UICode.save();
    }); //end #save.click()

    _jqButtons.open.click(function() {
      if (Trainer.is_training()) {
        alert('Please stop the current training before opening a new one');
        return;
      }

      // open the file
      $('#fileOpen').show();
    }); //end #open.click()
  }


  function sync(){
    update_buttonsState();
  }


  function update_buttonsState(){
    let enabledButtons = null;
    switch(Trainer.state){
      case Trainer.states.loading:
      case Trainer.states.error:
        enabledButtons = [];
        break;
      case Trainer.states.notLoaded:
        enabledButtons = [_jqButtons.run, _jqButtons.open];
        break;
      case Trainer.states.running:
        enabledButtons = [_jqButtons.pause];
        break;
      case Trainer.states.pause:
        _jqButtons.run.html('RESUME');
        enabledButtons = [_jqButtons.run, _jqButtons.step, _jqButtons.save];
        break;
      case Trainer.states.stop:
        enabledButtons = [_jqButtons.save];
        break;
    }
    for (let key in _jqButtons){
      const jqButton = _jqButtons[key];
      const isEnabled = enabledButtons.includes(jqButton);
      if (isEnabled){
        jqButton.removeClass('controlsButtonDisabled');
      } else {
        jqButton.addClass('controlsButtonDisabled');
      }
    }
  }


  const that = {
    sync: sync,

    init: function() {
      _jqStatus = $('#status');

      _jqButtons = {
        run: $('#buttonRun'),
        pause: $('#buttonPause'),
        step: $('#buttonStep'),
        save: $('#buttonSave'),
        open: $('#buttonOpen')
      }

      bind_jqButtons();
      sync();
    },

    set_status: function(status) {
      _jqStatus.html(status);
      sync();
    },
  }; //end that

  return that;
})();