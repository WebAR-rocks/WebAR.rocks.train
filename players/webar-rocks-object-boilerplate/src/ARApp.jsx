import { useState, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import isMobile from 'is-mobile'

// import main helper:
import threeHelper from './contrib/WebARRocksObject/helpers/WebARRocksObjectThreeHelper.js'

// import mediaStream API helper:
import mediaStreamAPIHelper from './contrib/WebARRocksObject/helpers/WebARRocksMediaStreamAPIHelper.js'

// import neural network model:

// Neural Network directly trained from WebAR.rocks.train/trainingScripts/Object3DLighter_0.js :
import NN from './assets/neuralNets/Object3DLighter_2025-03-10_uncompressed.json'
// Neural Network compressed by WebAR.rocks (contact-us for more information):
//import NN from './assets/neuralNets/NN_LIGHTER_5.json'

// import ObjectFollower 3D object:
import ObjectFollower from './3DComponents/ObjectFollower'

// import Guideline overlay:
import Guideline from './components/Guideline'

let _threeFiber = null


// fake component, display nothing
// just used to get the Camera and the renderer used by React-fiber:
const ThreeGrabber = (props) => {
  const threeFiber = useThree()
  _threeFiber = threeFiber
  useFrame(() => {
    threeHelper.update_threeCamera(props.sizing, threeFiber.camera)
    threeHelper.update_poses(threeFiber.camera)
  })
  return null
}


const compute_sizing = () => {
  // compute  size of the canvas:
  const height = screen.availHeight
  const wWidth = window.innerWidth
  const width = Math.min(wWidth, height)
  
  // compute position of the canvas:
  const top = 0
  const left = Math.max(0, (wWidth - width) * 0.5);
  return {width, height, top, left}
}


const ARApp = (props) => {
  // init state:
  const [sizing, setSizing] = useState(compute_sizing())
  const [isInitialized, setIsInitialized] = useState(false)
  const [isSelfieCam, setIsSelfieCam] = useState(!isMobile())
  const [isDisplayGuideline, setIsDisplayGuideline] = useState(true)

  // refs: 
  const canvasComputeRef = useRef()
  const cameraVideoRef = useRef()

  const _settings = {
    nDetectsPerLoop: 0, // 0 -> adaptative

    loadNNOptions: {
      notHereFactor: 0.0,
      paramsPerLabel: {
        LIGHTER: {
          thresholdDetect: 1.0
        }
      }
    },

    detectOptions: {
      isKeepTracking: true,
      isSkipConfirmation: false,
      thresholdDetectFactor: 1.2,
      //cutShader: 'median',
      thresholdDetectFactorUnstitch: 0.5,
      trackingFactors: [0.6, 0.6, 0.6]
    },

    cameraFov: 0, // auto evaluation
    scanSettings:{
      nScaleLevels: 3,
      overlapFactors: [3, 3, 3],//[5, 5, 4],
      scale0Factor: 0.5
    },

    followZRot: false,
  }
  let _timerResize = null
  
        
  const handle_resize = () => {
    // do not resize too often:
    if (_timerResize){
      clearTimeout(_timerResize)
    }
    _timerResize = setTimeout(do_resize, 200)
  }


  const do_resize = () => {
    _timerResize = null
    const newSizing = compute_sizing()
    setSizing(newSizing)
  }


  useEffect(() => {
    if (!_timerResize && _threeFiber && _threeFiber.gl){
      _threeFiber.gl.setSize(sizing.width, sizing.height, true)
    }
  }, [sizing])

 
  useEffect(() => {
    // for debugging: display the AR Object and exit:
    //setIsInitialized(true); return;

    // when videofeed is got, init WebAR.rocks.object through the threeHelper:
    const onCameraVideoFeedGot = () => {
      threeHelper.init({
        video: cameraVideoRef.current,
        ARCanvas: canvasComputeRef.current,
        NN,
        sizing,
        callbackReady: () => {
          // handle resizing / orientation change:
          window.addEventListener('resize', handle_resize)
          window.addEventListener('orientationchange', handle_resize)
          setIsInitialized(true)
          // detection callbacks:
          threeHelper.set_callback('LIGHTER', 'onloose', () => {
            console.log('LIGHTER DETECTION LOST')
          })
          threeHelper.set_callback('LIGHTER', 'ondetect', () => {
            console.log('LIGHTER DETECTED')
            setIsDisplayGuideline(false)
          })
        },
        loadNNOptions: _settings.loadNNOptions,
        nDetectsPerLoop: _settings.nDetectsPerLoop,
        detectOptions: _settings.detectOptions,
        cameraFov: _settings.cameraFov,
        followZRot: _settings.followZRot,
        scanSettings: _settings.scanSettings,
        stabilizerOptions: {n: 3}
      })
    }

    // get videoFeed:
    mediaStreamAPIHelper.get(cameraVideoRef.current, onCameraVideoFeedGot, (err) => {
      reject('Cannot get video feed ' + err)
    }, {
      video: { // put your video constraints here:
        width:  {min: 640, max: 1280, ideal: 1280},
        height: {min: 640, max: 1280, ideal: 720},
        facingMode: {ideal: 'environment'}
      },
      audio: false
    })

    return threeHelper.destroy
  }, [])


  const commonStyle = {
    width: sizing.width,
    height: sizing.height,
    top: sizing.top,
    left: sizing.left,
    position: 'fixed',
    objectFit: 'cover',
  }

  const ARCanvasStyle = Object.assign({
    zIndex: 2
  }, commonStyle)

  const cameraVideoStyle = Object.assign({
    zIndex: 1
  }, commonStyle)
  
  const mirrorClass = (isSelfieCam) ? 'mirrorX' : ''
  return (
    <div>
      {
        (isDisplayGuideline) && ( <Guideline onClose={() => { setIsDisplayGuideline(false) }}/> )
      }
      {/* Canvas managed by three fiber, for AR: */}
      <Canvas style={ARCanvasStyle} className={mirrorClass}
      gl={{
        preserveDrawingBuffer: true // allow image capture
      }}
      >
        <ThreeGrabber sizing={sizing} />
        <ObjectFollower label='LIGHTER' threeHelper={threeHelper} isInitialized={isInitialized} />
      </Canvas>

      {/* Video */}
      <video style={cameraVideoStyle} ref={cameraVideoRef} className={mirrorClass}></video>

      {/* Canvas managed by WebAR.rocks.object, used for WebGL computations) */}
      <canvas ref={canvasComputeRef} style={{display: 'none'}} width={512} height={512} />
    </div>
  )
} 

export default ARApp