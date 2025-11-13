/*
  detect a bunch of N objects.
  for each object, returns:

   * here result (0 or 1)
   * notHere result (0 or 1)
   * yaw rotation (around Y): the object is supposed to be on the ground (so roll and pitch are locked). Between -1 and 1
   * dx: displace horizontally 2d detection window to match with the object
   * dy: displace vertically 2d detection window
   * ds: scale 2d detection window

   we use THREE.js
*/

window['PROBLEMPROVIDERS']['ObjectDetectionTrainer'] = (function(){

  const _settings = {
    pointLightNumberRange:[3, 6], // min and max number of lights
    pointLightMaxIntensity: 0.5, // max intensity of point lights
    ambientLightIntensityRange: [0, 1],
    updatePointLightsPeriod: 30, // update point light each...

    phiRange: [30, 80], // 1st value->vertical, 2nd -> hzt

    envMapsPath: 'trainingData/images/envMaps/cubes/',
    envMapsNames: ['Bridge2', 'DallasW', 'MarriottMadisonWest', 'Park2', 'Vasa']
  };

  const _d2r = Math.PI / 180; // degrees to radians

  let _isSharedContext = false;
  const _objects = {
    all: null,
    labels: [],
    distances: [],
    neg: [],
    pos: []
  };
  const _dims = {
    outputWidth: -1,
    inputWidth: -1,
    renderWidth: -1
  }
  const _cameraParams = {
    FOV: -1,
    aspectRatio: -1
  }
  let _positiveProbability = 0;
  let _isFatalError = false;

  const _noiseTextures = [];

  // textures:
  const _textures = {
    input: null,
    expected: null,
    render: null,
    deltaMask: null,
    clampMask: null
  };
  let _deltaMaskArr = null, _expectedArr = null, _clampMaskArr = null;
  let _trainingDataRoot = '';


  // THREE.js instances:
  const _three = {
    renderer: null,
    loadingManager: null,
    composer: null,
    scene: null,
    camera: null,
    lights: null,
    sceneLights: [],
    origin: null,
    planeMesh: null,
    envMaps: [],
    debugTexture: null,
    sceneObjects: []
  };

  _picked = {
    theta: 0, phi: 0,
    dx: undefined, dy: undefined, ds: undefined,
    dxNormalized: undefined, dyNormalized: undefined, dsNormalized: undefined,
    drawnObject: null,
    drawnMesh: null,
    drawnTrainingSet: null,
    isPositive: false,
    label: null
  };

  let _counter = 0;
  
  const _testing = {
    detectedObjScoreMin: 0
  };

  const _lighting = {
    pointLightNumberRange: [_settings.pointLightNumberRange[0], _settings.pointLightNumberRange[0]],
    ambientIntensityRange: [_settings.ambientLightIntensityRange[0], _settings.ambientLightIntensityRange[1]],
    pointLightMaxIntensity: -1,
    updatePointLightsPeriod: _settings.updatePointLightsPeriod,
    maxDistance: 0
  };

  const _randomizationAreas = {
    isEnabled: false,
    updatePeriod: 0,
    container: null,
    geometries: null,
    areas: null
  };
  
  // object movement (for rotation and tranlation):
  const _move = {
    phiRangeRad: [_settings.phiRange[0] * _d2r, _settings.phiRange[1] * _d2r],
    rotZ: {angleMaxRad: 0, nSigmas: 2},
    rotZRad: 0,
    outputAngles: null,
    splitYawComponents: false,
    translationScalingFactors: null,
    translationScalingFactorsDistributions: null,
    usedOutputOffsets: []
  };

  const _loading = {
    nToLoad: -1,
    nLoaded: -1,
    onloadCallback: null
  };

  function check_isLoaded(label){
    if (++_loading.nLoaded === _loading.nToLoad){
      console.log('INFO in ObjectDetectionTrainer.js - init(): all stuffs are loaded');

      on_load();

      if (_loading.onloadCallback){
        _loading.onloadCallback();
      }
    }
  };


  function on_load() {
    // for each objects, compute the average height:
    _objects.all.forEach(function(obj){
      obj.height = 0;
      let denom = 0;
      obj.trainingSets.forEach(function(trainingSet){
        if (trainingSet.type !== '3D'){
          return;
        }
        trainingSet.meshesBuilt.forEach(function(threeMesh){
          obj.height += threeMesh.userData.height;
          ++denom;
        }); //end loop on three meshesBuilt
      }); //end loop on trainingsets
      if (denom !== 0){
        obj.height /= denom;
      }
      if (isNaN(obj.height)){
        obj.height = -1;
      }
      console.log('INFO in ObjectDetectionTrainer.js - on_load(): Average height for', obj.label,' = ', obj.height);
    });//end loop on _objects.all

    // separate negative detection training sets:
    _objects.pos.splice(0);
    _objects.neg.splice(0);
    _objects.labels.splice(0);
    _objects.distances.splice(0);
    _objects.all.forEach(function(obj){
      if (obj.label){
        _objects.labels.push(obj.label);
        _objects.distances.push(obj.distance);
        _objects.pos.push(obj);
      } else {
        _objects.neg.push(obj);
      }
    });

    // for each positive object, compute its position:
    for (let y=0; y<_dims.outputWidth/8; ++y) {
      for (let x=0; x<_dims.outputWidth; ++x) {
        const iObj = x + y*_dims.outputWidth;
        const obj = _objects.pos[iObj];
        if (!obj) continue;
        obj.xOutput = x;
        obj.yOutput = y;
      }
    }

  }; // end on_load


  function center_mesh(threeMesh, scale) {
    const threeBox = new THREE.Box3().setFromObject(threeMesh);
    const threeBoxCenterInv = threeBox.max.clone().add(threeBox.min).multiplyScalar(-0.5);
    
    if (threeMesh.geometry){
      const threeMovGeomMat = new THREE.Matrix4().setPosition(threeBoxCenterInv);
      threeMesh.geometry.applyMatrix4(threeMovGeomMat);
    } else {
      threeBoxCenterInv.multiplyScalar(scale);
      threeMesh.position.copy(threeBoxCenterInv);
    }

    threeMesh.userData.height = threeBox.max.y - threeBox.min.y;

    return threeMesh;
  };


  function load_trainingSet(trainingSet) {
    switch(trainingSet.type){
      case 'IMAGESATLAS':
        load_imageAtlasTrainingSet(trainingSet);
        break;

      case '3D':
      default:
        load_3DTrainingSet(trainingSet);
        break;
    }
  }


  function build_envMaps(){
    console.log('INFO in ObjectDetectionTrainer: build_envMaps()...');
    _settings.envMapsNames.forEach(function(envMapPath){
      const urls = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'].map(function(directionName){
        const imageFullPath = add_rootPath( _settings.envMapsPath + envMapPath + '/' + directionName + '.jpg' );
        return imageFullPath;
      });

      const textureCube = new THREE.CubeTextureLoader(_three.loadingManager).load( urls );
      _three.envMaps.push(textureCube);
    });

    // tweak shaderChunks for envMap randomization:
    const searchGLSL = 'vec3 worldNormal = inverseTransformDirection( geometry.normal, viewMatrix );';
    const replaceGLSL = searchGLSL + '\nworldNormal = envMapRot * worldNormal;\n'
    THREE.ShaderChunk.envmap_physical_pars_fragment_tweaked = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(searchGLSL, replaceGLSL);
    
    const searchGLSL2 = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );'
    const replaceGLSL2 = searchGLSL2 + '\nreflectVec = envMapRot * reflectVec;\n';
    THREE.ShaderChunk.envmap_physical_pars_fragment_tweaked = THREE.ShaderChunk.envmap_physical_pars_fragment_tweaked.replace(searchGLSL2, replaceGLSL2);      
  }
  

  function alter_materials(threeStuff, matNames, tweakerFunction){
    if (!matNames){
      return;
    }

    threeStuff.traverse(function(threeChild){
      if (threeChild.type !== 'Mesh'){
        return;
      }

      if (!threeChild.material){
        console.log('ERROR: threeChild has no material.');
        debugger;
      }
      const materials = (threeChild.material.length) ? threeChild.material : [threeChild.material];

      materials.forEach(function(material){
        if (matNames !== 'ALL' && 
          !(material.name && !matNames.includes(material.name))){
          return;
        }
        let mat = material;
        if (!mat){
          mat = new THREE.MeshPhongMaterial();
          threeChild.material = mat;
        }
        tweakerFunction(mat);
      }); //end loop on threeChild materials
      
    }); //end traverse threeStuff
  }


  function add_onBeforCompileCallback(mat, cb){
    if (!mat.onBeforeCompile){
      mat.onBeforeCompile = cb;
      return;
    }
    const cbPrev = mat.onBeforeCompile;
    mat.onBeforeCompile = function(shader, renderer){
      cbPrev(shader, renderer);
      cb(shader, renderer);
    }
  }


  function add_envMap(threeStuff, matNames){
    threeStuff.userData.envMapMaterials = [];
    threeStuff.userData.envMapRot = new THREE.Matrix3();
    
    alter_materials(threeStuff, matNames, function(mat){
      console.log('ADD ENVMAP ON MATERIAL', mat.name);
      //tweak the material to add envMapRot as uniform:
      
      add_onBeforCompileCallback(mat, function(shader, renderer){
        const GLSLEnvMapRotDeclaration = 'uniform mat3 envMapRot;';
        if (!shader.fragmentShader.includes(GLSLEnvMapRotDeclaration)){
          shader.fragmentShader = GLSLEnvMapRotDeclaration + '\n' + shader.fragmentShader.replace('<envmap_physical_pars_fragment>', '<envmap_physical_pars_fragment_tweaked>');
          shader.uniforms.envMapRot = {
            value: threeStuff.userData.envMapRot
          }
        }
      });

      threeStuff.userData.envMapMaterials.push(mat);
    });
  }


  function alter_map(threeStuff, matNames){
    if (_noiseTextures.length === 0){
      return;
    }

    // collect meshes where applying the map noise:
    threeStuff.userData.noiseMap = true;
    threeStuff.userData.noiseMapMeshes = [];
    threeStuff.traverse(function(threeNode){
      if (!threeNode.material){
        return;
      }
      if (matNames === 'ALL' || matNames.includes(threeNode.material.name)){
        threeStuff.userData.noiseMapMeshes.push(threeNode);
      }
    });
  }


  function alter_bumpMap(threeStuff, matNames){
    if (_noiseTextures.length === 0){
      return;
    }
    threeStuff.userData.noiseBump = {
      noiseBumpMap: { value: null },
      noiseOffset: { value: new THREE.Vector2() },
      noiseScale: { value: new THREE.Vector2()},
      noiseTheta: { value: 0 }
    };
    threeStuff.userData.noiseBumpMaterials = [];

    alter_materials(threeStuff, matNames, function(mat){
      mat.bumpMap = _three.debugTexture;
      
      add_onBeforCompileCallback(mat, function(shader, renderer){
        const GLSLComputeBump = '\n\
          uniform vec2 noiseOffset, noiseScale;\n\
          uniform float noiseTheta;\n\
          uniform sampler2D noiseBumpMap;\n\
          uniform sampler2D bumpMap;\n\
          uniform float bumpScale;\n\
          vec2 dHdxy_fwd() {\n\
            float cosNoiseTheta = cos(noiseTheta);\n\
            float sinNoiseTheta = sin(noiseTheta);\n\
            mat2 noiseRotMat = mat2( cosNoiseTheta, sinNoiseTheta, -sinNoiseTheta, cosNoiseTheta );\n\
            vec2 uv = (noiseRotMat * vUv) * noiseScale + noiseOffset;\n\
            \n\
            vec2 dSTdx = dFdx( uv );\n\
            vec2 dSTdy = dFdy( uv );\n\
            float Hll = bumpScale * texture2D( noiseBumpMap, uv ).x;\n\
            float dBx = bumpScale * texture2D( noiseBumpMap, uv + dSTdx ).x - Hll;\n\
            float dBy = bumpScale * texture2D( noiseBumpMap, uv + dSTdy ).x - Hll;\n\
            return vec2( dBx, dBy );\n\
          }\n\
          vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy ) {\n\
            vec3 vSigmaX = vec3( dFdx( surf_pos.x ), dFdx( surf_pos.y ), dFdx( surf_pos.z ) );\n\
            vec3 vSigmaY = vec3( dFdy( surf_pos.x ), dFdy( surf_pos.y ), dFdy( surf_pos.z ) );\n\
            vec3 vN = surf_norm;\n\
            vec3 R1 = cross( vSigmaY, vN );\n\
            vec3 R2 = cross( vN, vSigmaX );\n\
            float fDet = dot( vSigmaX, R1 );\n\
            fDet *= ( float( gl_FrontFacing ) * 2.0 - 1.0 );\n\
            vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );\n\
            return normalize( abs( fDet ) * surf_norm - vGrad );\n\
          }\n\
        ';
        shader.fragmentShader = shader.fragmentShader.replace('#include <bumpmap_pars_fragment>', GLSLComputeBump);

        for (let uniformKey in threeStuff.userData.noiseBump){
          shader.uniforms[uniformKey] = threeStuff.userData.noiseBump[uniformKey];
        }
      })
      threeStuff.userData.noiseBumpMaterials.push(mat);

    });
  }


  function add_rootPath(url){
    return lib_url.add_root(url, _trainingDataRoot, 'trainingData/');
  }


  function load_imageAtlasTrainingSet(trainingSet) {
    /*
    trainingSet properties:
      imagesPrefix: 'trainingData/cat-dataset/processed/atlases/catAtlas_',
        imagesExtension: 'png',
        imagesNumber: 5,
        imagesTest: [0],
        nSamplesPerSide: [32,32]
    */
    trainingSet.type = 'IMAGESATLAS';

    // load texture atlases as textures:
    trainingSet.testingTextureAtlases = [];
    trainingSet.trainingTextureAtlases = [];

    for (let i=0; i<trainingSet.imagesNumber; ++i){
      const textureURL = trainingSet.imagesPrefix + i.toString() + '.' + trainingSet.imagesExtension;
      const threeTexture = new THREE.TextureLoader(_three.loadingManager).load( add_rootPath(textureURL) );
      const textureAtlases = (trainingSet.imagesTest.indexOf(i)===-1) ? trainingSet.trainingTextureAtlases : trainingSet.testingTextureAtlases;
      textureAtlases.push(threeTexture);
    }
  }

  // PBR mat can be slow, so we replace it if asked:
  function replace_PBRMaterials(threeMesh){
    threeMesh.traverse(function(threeStuff){
      if (threeStuff.type!=='Mesh' || !threeStuff.material || threeStuff.material.type!=='MeshStandardMaterial'){
        return;
      }

      const PBRMat = threeStuff.material;
      const newMat = new THREE.MeshPhongMaterial();

      newMat.color.copy(PBRMat.color);
      ['envMap', 'map'].forEach(function(key){
        newMat[key] = PBRMat[key];
      });

      threeStuff.material = newMat;
      threeStuff.userData.oldMaterial = PBRMat;
    });
  }

  function setup_mesh(meshURL, threeMesh, trainingSet){
    if (_isFatalError){
      return;
    }
    lib_three.reset_texturesEncoding(threeMesh);

    if (typeof(trainingSet.enablePBR)!=='undefined' && !trainingSet.enablePBR){
      replace_PBRMaterials(threeMesh);
    }

    const scale = (trainingSet.scale) ? trainingSet.scale : 1;
    const centeredMesh = (typeof(trainingSet.isCenter) === 'undefined' || trainingSet.isCenter) ? center_mesh(threeMesh, scale) : threeMesh;
    trainingSet.meshesBuilt.push(centeredMesh);
    
    if (scale){
      threeMesh.scale.multiplyScalar(scale);
    }

    add_envMap(threeMesh, trainingSet.envMapMats);
    alter_map(threeMesh, trainingSet.alterMapMats)
    alter_bumpMap(threeMesh, trainingSet.alterBumpMapMats)

    threeMesh.userData.thetaRange = [-Math.PI, Math.PI];
    if (trainingSet.thetaRange){
      threeMesh.userData.thetaRange[0] = trainingSet.thetaRange[0] * _d2r;
      threeMesh.userData.thetaRange[1] = trainingSet.thetaRange[1] * _d2r;
    }

    if (trainingSet.onThreeLoad){
      trainingSet.onThreeLoad(threeMesh, meshURL, trainingSet);
    }

    if (trainingSet.thetaOffset){
      // if just 1 component is provided, use it for Y:
      const thetaOffsetXYZ = (typeof(trainingSet.thetaOffset) === 'number') ? [0, trainingSet.thetaOffset, 0] :  trainingSet.thetaOffset;
      
      // convert degrees to radians and build THREE.js Euler angle::
      const thetaOffsetXYZRad = thetaOffsetXYZ.map(function(theta){
        return theta * _d2r;
      });
      const thetaOffsetEuler = new THREE.Euler().fromArray(thetaOffsetXYZRad);
      const threeRotMat = new THREE.Matrix4().makeRotationFromEuler(thetaOffsetEuler);

      // Apply rotation:
      if (threeMesh.geometry){        
        threeMesh.geometry.applyMatrix4(threeRotMat);
      } else {
        threeMesh.applyMatrix4(threeRotMat);
      }
    }

    if (trainingSet.debug){
      console.log('DEBUG: ',meshURL, 'is available as global variable debugMesh');
      window.debugMesh = threeMesh;
    }
    console.log('INFO in ObjectDetectionTrainer - init(): ', meshURL, 'loaded');
  }


  function load_3DTrainingSet(trainingSet) {
    /*
      trainingSet properties:
          meshes: build_offMeshesList2('cup', ['01', '01', '02', '03', '04', ]),
            materials:  ThreeMaterials.get_phongs()
      */
     
    // set some default params:
    trainingSet.alterBumpMapScaleMax = trainingSet.alterBumpMapScaleMax || 0.1;
    trainingSet.type = '3D';
    trainingSet.meshesBuilt = [];
    
    //build meshes
    trainingSet.meshes.forEach(function(meshURL0, meshIndex){
      const meshURL = add_rootPath(meshURL0);

      switch(lib_url.get_extension(meshURL)){
        case 'GLB':
        case 'GLTF':
          const gltfLoader = new THREE.GLTFLoader(_three.loadingManager);
          gltfLoader.load(meshURL, function(threeStuff){
            if (!threeStuff.scenes || threeStuff.scenes.length!==1){
              throw new Error ('Invalid scenes count in GLTF file ' + meshURL);
            }
            //const threeMesh = threeStuff.scenes[0].children[0];
            const threeMesh = threeStuff.scenes[0];
            setup_mesh(meshURL, threeMesh, trainingSet);
          });
          break;

        case 'OFF': // see http://www.ctyeung.com/js/Threejs/examples/webgl_loader_off.html
          const offLoader = new THREE.OFFLoader(_three.loadingManager);
          offLoader.load(meshURL, function(rawObject){
            const threeGeom = ThreeAggregator.aggregate(rawObject);
            threeGeom.mergeVertices();
            threeGeom.computeVertexNormals();

            const threeMesh = new THREE.Mesh(threeGeom, new THREE.MeshPhongMaterial());
            threeMesh.rotateX(-Math.PI / 2); //because Y and Z are inverted
            setup_mesh(meshURL, threeMesh, trainingSet);
          });
          break;

        case 'OBJ': // see https://threejs.org/docs/#api/loaders/ObjectLoader
          const objLoader =  new THREE.OBJLoader( _three.loadingManager );
          const mtlFile = (trainingSet.mtlFiles && trainingSet.mtlFiles.length) ? trainingSet.mtlFiles[meshIndex] : null;
          
          const load_obj = function(){
            objLoader.load( meshURL, function ( rawMesh ) {
              let threeMesh = false;
              rawMesh.traverse(function(threeStuff){
                if (threeStuff.type !== 'Mesh'){
                  return;
                }
                if (threeMesh && threeStuff!==threeMesh){
                  console.log('WARNING in ObjectDetectionTrainer - init(): this mesh', meshURL, 'contains more than 1 mesh. Fix it bro');
                  return;
                }
                threeMesh = threeStuff;
              }) //end loop on mesh components
              if (threeMesh){
                setup_mesh(meshURL, threeMesh, trainingSet);
              } else {
                console.log('WARNING in ObjectDetectionTrainer - init(): this mesh', meshURL, 'is empty');
              }
            }); //end loader callback
          } //end load_obj()

          if (mtlFile === null){
            load_obj();
          } else {
            const materialsCreator = new THREE.MTLLoader( _three.loadingManager ).load(mtlFile, function(materials){
              materials.preload();
              objLoader.setMaterials(materials);
              load_obj();
            });
          }
          break; //end if .OBJ file

      }; //end switch mesh URL
      
    });//end loop on meshes

    //build materials 
    trainingSet.materialsBuilt = [];
    if (trainingSet.materials){
      trainingSet.materials.forEach(function(material){
        ++_loading.nToLoad;
        if (material.type && material.type.indexOf('Material')!==-1){ // already an instance of THREE.XXXMaterial
          trainingSet.materialsBuilt.push(material);
          check_isLoaded('MAT');
        }
      }); //end loop on materials
    }

    //build textures
    trainingSet.texturesBuilt = [];
    if (trainingSet.textureImages){
      trainingSet.textureImages.forEach(function(imageURL){
        const threeTexture = new THREE.TextureLoader(_three.loadingManager).load( add_rootPath(imageURL) );
        threeTexture.wrapS = THREE.RepeatWrapping;
        threeTexture.wrapT = THREE.RepeatWrapping;
        trainingSet.texturesBuilt.push(threeTexture);
      });
    }
  }; //end load_trainingSet()


  function fill_outputArr(arr, x, y, i, v){
    if (isNaN(v)){
      throw new Error('Error in ObjectDetectionTrainer - fill_outputArr(): NaN value');
    }

    // pixel index:
    let iPix = y * 8 * _dims.outputWidth + x;
    iPix += (i * _dims.outputWidth);

    // scale value if necessary:
    const vs = (arr instanceof Uint8Array) ? v * 255 : v;

    arr[4*iPix]     = vs; // R
    arr[4*iPix + 1] = vs; // G
    arr[4*iPix + 2] = vs; // B
    arr[4*iPix + 3] = vs; // A
  }


  function get_outputArr(arr, x, y, i){
    let iPix = y * 8 * _dims.outputWidth + x;
    iPix += (i * _dims.outputWidth);
    const v = arr[4*iPix];
    const vFloat = (arr instanceof Uint8Array) ? v / 255 : v;
    return vFloat;
  }


  function get_resultPix (NNresult, xObj, yObj, yOffset){
    const yPix = yObj * 8 + yOffset;
    //const yPixInv = _dims.outputWidth - 1 - yPix;
    const iPix = xObj + yPix * _dims.outputWidth;
    return (NNresult[iPix][0] + NNresult[iPix][1] + NNresult[iPix][2] + NNresult[iPix][3]) / 4;
  }


  function update_dirLighting(){
    // remove lights:
    _three.sceneLights.forEach(function(threeLight){
      _three.scene.remove(threeLight);
    });
    _three.sceneLights = [];

    // add new lights:
    const nPointLightsEnabled = lib_random.get_intInRange(_lighting.pointLightNumberRange);
    for (let i=0; i<nPointLightsEnabled; ++i){
      const threeLight = _three.lights.points[i];
      threeLight.intensity = Math.random() * _lighting.pointLightMaxIntensity;
      threeLight.position.fromArray(lib_random.pick_hemiIsotropicVec3()).multiplyScalar(_lighting.maxDistance*2);
      _three.scene.add(threeLight);
      _three.sceneLights.push(threeLight);
    }
  }


  function get_label(obj){
    if (!obj || !obj.label || obj.label==='NONE'){
      return 'NONE';
    }
    return obj.label;
  }


  function load_textures(texturesParams, textures){
    texturesParams.forEach(function(params){
      const offset = (params.countOffset) ? params.countOffset: 0;
      for (let i=0; i<params.n; ++i){
        let fileName = (i + offset).toString();
        if (params.fileNameCharsCount){
          while (fileName.length < params.fileNameCharsCount) fileName = '0' + fileName;
        }

        const imageUrl = params.image.replace('*', fileName);
        const threeTextureLoader = new THREE.TextureLoader( _three.loadingManager, function(texture){
          // free space on RAM:
          texture.onUpdate = function(texture){
            delete(texture.image);
          }
        } );
        const threeTexture = threeTextureLoader.load( add_rootPath(imageUrl) );
        threeTexture.wrapS = THREE.RepeatWrapping;
        threeTexture.wrapT = THREE.RepeatWrapping;
        textures.push({
          texture: threeTexture,
          scaleRange: params.scaleRange,
          scalePow: params.scalePow
        });
      } //end loop on i
    }); //end loop on texturesParams
  }


  function set_GLState(){
    if (_isSharedContext){
      FBO.unbind();
      Shaders.unset();
      Texture.reset();
    } else {
      FBO.bind_default();
    }
  }


  function unset_GLState(){
    if (_isSharedContext){
      Shaders.enable_vertexAttrib0();
      GL.disable(GL.BLEND);
      Shaders.unset();
      Texture.reset();
      VBO.bind_quad();
      FBO.bind_default();

      // generate input texture mipmaps level
      // otherwise sampling is bad:
      _textures.input.bind_toSampler(0);
      _textures.input.generate_mipmap();

      Texture.reset();

      Context.set_GLState();
    }
  }


  function pick_random(){
    // pick random object to draw:
    let drawnObject = null;
    if (Math.random() <= _positiveProbability){
      drawnObject = lib_array.pick_randomObjectDistribution(_objects.pos);  
    }

    // label is only for positive objects:
    _picked.isPositive = (drawnObject) ? true: false;
    _picked.label = get_label(drawnObject);

    if (_objects.neg.length>0 && !drawnObject){
      drawnObject = lib_array.pick_randomObjectDistribution(_objects.neg);
    }

    _picked.drawnObject = drawnObject; // should be false if negObject drawed

    // get training set:
    if (_picked.drawnObject){
      _picked.drawnTrainingSet = lib_array.pick_randomObjectDistribution(_picked.drawnObject.trainingSets);
    } else {
      _picked.drawnTrainingSet = null;
    }

    // get mesh:
    if (_picked.drawnTrainingSet && _picked.drawnTrainingSet.meshesBuilt){
      _picked.drawnMesh = lib_array.pick_random(_picked.drawnTrainingSet.meshesBuilt);
    }

    // pick random 2D displacement values:
    const dxMax = _move.translationScalingFactors[0], dyMax = _move.translationScalingFactors[1], dsMax = _move.translationScalingFactors[2];
    _picked.dx = lib_random.pick_randomFromDistribution(-dxMax, dxMax, _move.translationScalingFactorsDistributions[0]);
    _picked.dy = lib_random.pick_randomFromDistribution(-dyMax, dyMax, _move.translationScalingFactorsDistributions[1]);
    _picked.ds = lib_random.pick_randomFromDistribution(-dsMax, dsMax, _move.translationScalingFactorsDistributions[2]);
    //_picked.dx = 0.5, _picked.dy = 0, _picked.ds = 0; //KILL

    // normalize 2D displacement (put in [-1, 1] range ) for the output;
    _picked.dxNormalized = (_move.translationScalingFactors[0]===0) ? 0 : _picked.dx / _move.translationScalingFactors[0];
    _picked.dyNormalized = (_move.translationScalingFactors[1]===0) ? 0 : _picked.dy / _move.translationScalingFactors[1];
    _picked.dsNormalized = (_move.translationScalingFactors[2]===0) ? 0 : _picked.ds / _move.translationScalingFactors[2];
  }


  function update_lighting(){
    if (_counter % _lighting.updatePointLightsPeriod === 0){
      update_dirLighting();
    }
    _three.lights.ambient.intensity = lib_random.get_floatInRange(_lighting.ambientIntensityRange);
  }


  function update_camera(){
    // SET FOV IF NECESSARY:
    let distanceFovFactor = 1.0;
    if (typeof(_cameraParams.FOV) !== 'number'){
      const fov = lib_random.get_floatInRange(_cameraParams.FOV);
      _three.camera.fov = fov;
      _three.camera.updateProjectionMatrix();

      // change the object displayed distance (the distance is given for FoV = 40):
      distanceFovFactor = Math.tan(40 * _d2r / 2) / Math.tan(fov *_d2r / 2);
    }

    // SET CAMERA POSITION AND ROTATION:
    
    // check theta and phi range
    if (_picked.drawnMesh.userData.thetaRange[0] === _picked.drawnMesh.userData.thetaRange[1]){
      throw new Error('Invalid thetaRange: ' + _picked.drawnMesh.userData.thetaRange.toString());
    }
    if (_move.phiRangeRad[0] === _move.phiRangeRad[1]){
      throw new Error('Invalid phiRange: ' + _move.phiRangeRad.toString());
    }

    // pick isotropic position:
    let theta = 0, phi = 0;
    do {
      const thetaPhi = lib_random.pick_isotropicThetaPhi();
      theta = thetaPhi[0]; // yaw
      phi = thetaPhi[1];
      if (theta > Math.PI) theta-=2.0*Math.PI; // bring theta in [-pi, pi]
      if( _move.phiRangeRad[0] === _move.phiRangeRad[1]){
        phi = _move.phiRangeRad[0];
      }
    } while(phi<_move.phiRangeRad[0] || phi>_move.phiRangeRad[1] || theta<_picked.drawnMesh.userData.thetaRange[0] || theta>_picked.drawnMesh.userData.thetaRange[1]);
    _picked.theta = theta;
    _picked.phi = phi;

    _three.camera.position.set(
      Math.cos(theta) * Math.sin(phi),
      Math.cos(phi),
      Math.sin(theta) * Math.sin(phi)
    ).multiplyScalar(_picked.drawnObject.distance * distanceFovFactor);
    _three.camera.lookAt(_three.origin);

    // ADD RANDOM Z ROTATION:
    _three.camera.rotateZ(_move.rotZRad);
  }



  function add_meshToScene(){
    // append the mesh to the scene:
    const drawnMesh = _picked.drawnMesh;
    if (!drawnMesh){
      console.log('ERROR: drawnMesh is undefined');
      debugger;
    }
    const drawnMeshData = drawnMesh.userData;

    // apply random envmap:
    if (drawnMeshData.envMapMaterials && _three.envMaps.length){
      const envMap = lib_array.pick_random(_three.envMaps);
      drawnMeshData.envMapMaterials.forEach(function(threeMat){
        threeMat.envMap = envMap;
      });
      drawnMeshData.envMapRot.rotate(Math.random() * Math.PI * 2);
    }

    // apply noise to the map:
    if (drawnMeshData.noiseMap){
      drawnMeshData.noiseMapMeshes.forEach(function(threeMesh){
        const noiseTexture = lib_array.pick_random(_noiseTextures);
        threeMesh.material.map = noiseTexture.texture;

        // randomize texture application
        noiseTexture.texture.offset.set(Math.random(), Math.random());
        noiseTexture.texture.rotation = Math.random() * Math.PI * 2;
        const scale = lib_random.get_floatMinMaxPow(noiseTexture.scaleRange[0], 1, noiseTexture.scalePow);
        noiseTexture.texture.repeat.set(scale, scale);
      });
    }


    // apply noise to material map:
    if (drawnMeshData.noiseBump){
      const noiseTexture = lib_array.pick_random(_noiseTextures);
      drawnMeshData.noiseBumpMaterials.forEach(function(threeMat){
        const img = noiseTexture.texture.image;
        const a = img.width / img.height;
        const scaleMax = Math.min(1/a, noiseTexture.scaleRange[1]);
        const scaleUV = lib_random.get_floatMinMaxPow(noiseTexture.scaleRange[0], scaleMax, noiseTexture.scalePow);
        const noiseTheta = Math.random() * Math.PI * 2;

        const uniforms = drawnMeshData.noiseBump;
        uniforms.noiseBumpMap.value = noiseTexture.texture;
        uniforms.noiseTheta.value = noiseTheta;
        uniforms.noiseScale.value.set(scaleUV, scaleUV*a);
        uniforms.noiseOffset.value.set(Math.random(), Math.random());
        
        threeMat.bumpScale = Math.random() * _picked.drawnTrainingSet.alterBumpMapScaleMax;
      });
    }

    // apply material tweakers:
    if (_picked.drawnTrainingSet.materialsTweakers){
      const tweakers = _picked.drawnTrainingSet.materialsTweakers;
      drawnMesh.traverse(function(threeStuff){
        if (threeStuff.type!=='Mesh'){
          return;
        }
        if (! threeStuff.material){
          return;
        }

        const materials = (!threeStuff.material.length) ? [ threeStuff.material ] : threeStuff.material;
        const materialsTweakerNames = Object.keys(tweakers);

        materials.forEach(function(material){
          // exact search:
          if (material.name && tweakers[material.name]) {
            tweakers[material.name](material, threeStuff);
            return;
          }
          // name chunk search:
          if (material.name && material.name.length > 3){
            const tweakerKey = materialsTweakerNames.find(function(tweakerName){
              return material.name.includes(tweakerName);
            });
            if (tweakerKey){
              tweakers[tweakerKey](material, threeStuff);
              return;
            }
          }
          // ALL tweaker:
          if (tweakers['ALL']){
            tweakers['ALL'](material, threeStuff);
          }
        });
        
      }); //end traverse drawnMesh
    }

    if (_picked.drawnTrainingSet.meshesTweakers){
      drawnMesh.traverse(function(threeStuff){
        if (threeStuff.type!=='Mesh'){
          return;
        }
        if (threeStuff.name && _picked.drawnTrainingSet.meshesTweakers[threeStuff.name]) {
          _picked.drawnTrainingSet.meshesTweakers[threeStuff.name](threeStuff);
        } else if (_picked.drawnTrainingSet.meshesTweakers['ALL']){
          _picked.drawnTrainingSet.meshesTweakers['ALL'](threeStuff);
        }
      }); //end traverse drawnMesh  
    }

    _three.scene.add(drawnMesh);
    _three.sceneObjects.push(drawnMesh);

    //tweak the material:
    if (_picked.drawnTrainingSet.materialsBuilt.length>0){
      const drawedMaterial = lib_array.pick_random(_picked.drawnTrainingSet.materialsBuilt);
      
      if (_picked.drawnTrainingSet.texturesBuilt.length>0){
        const drawedTexture = lib_array.pick_random(_picked.drawnTrainingSet.texturesBuilt);
        drawedMaterial.map = drawedTexture;

        if (_picked.drawnTrainingSet.textureRandomizeOffset){
          drawedMaterial.map.offset.set(Math.random(), Math.random());
        }
        if (_picked.drawnTrainingSet.textureRandomizeScaleRange){
          drawedMaterial.map.repeat.set(
            1.0 / lib_random.get_floatMinMax(_picked.drawnTrainingSet.textureRandomizeScaleRange[0], _picked.drawnTrainingSet.textureRandomizeScaleRange[1]),
            1.0 / lib_random.get_floatMinMax(_picked.drawnTrainingSet.textureRandomizeScaleRange[0], _picked.drawnTrainingSet.textureRandomizeScaleRange[1])
            );
        }

      } else {
        drawedMaterial.map = null;
      }

      drawnMesh.material = drawedMaterial;
    }
  }


  function add_imageToScene(isTest){
    // pick the good texture atlas:
    const textureAtlases = (isTest) ? _picked.drawnTrainingSet.testingTextureAtlases : _picked.drawnTrainingSet.trainingTextureAtlases;
    const textureAtlas = lib_array.pick_random(textureAtlases);

    // pick a sample picture into the texture atlas:
    const sampleUV = [
      lib_random.get_int(_picked.drawnTrainingSet.nSamplesPerSide[0]),
      lib_random.get_int(_picked.drawnTrainingSet.nSamplesPerSide[1])
    ];
    const sampleDUV = [
      1.0 / _picked.drawnTrainingSet.nSamplesPerSide[0],
      1.0 / _picked.drawnTrainingSet.nSamplesPerSide[1]
    ];
    sampleUV[0] *= sampleDUV[0];
    sampleUV[1] *= sampleDUV[1];

    // set uniforms:
    _three.planeMesh.material.uniforms.sampleUV.value.fromArray(sampleUV);
    _three.planeMesh.material.uniforms.sampleDUV.value.fromArray(sampleDUV);
    _three.planeMesh.material.uniforms.samplerImage.value = textureAtlas;
    _three.planeMesh.material.uniforms.rotZ.value = _move.rotZRad;

    _three.scene.add(_three.planeMesh);
    _three.sceneObjects.push(_three.planeMesh);
  }


  function render(){
    // RENDER THE SCENE:
    if (_isSharedContext){
      //VBO.unbind();

      // at the end the rendering of the object (without background is on _textures.render):
      GL.viewport(0, 0, _dims.renderWidth, _dims.renderWidth);
      _three.renderer.state.reset();
      
      _three.composer.resetRenderBuffersOrder();
      _three.composer.render();
      _textures.render.set_glTexture(_three.renderer.properties.get(_three.composer.renderer.getRenderTarget().texture).__webglTexture);
      
      FBO.bind_default();
    } else {
      _three.composer.render();
    }
    
    // clean scene for next rendering:
    _three.sceneObjects.forEach(function(obj){
      _three.scene.remove(obj);
    })

    // COPY THE RENDER TO _textures.render:
    if (! _isSharedContext){
      _textures.render.update();
    }
    Texture.unbind(0);
  }


  function crop_renderTexture(backgroundTexture){
    // CROP IT TO BUILD THE INPUT:
    _textures.input.set_asRenderTargetVp();
    
    // draw background:
    Shaders.set('shp_copy');
    VBO.bind_quad();
    GL.enable(GL.BLEND);
    GL.clearColor(0, 0, 0, 0);
    GL.clear(GL.COLOR_BUFFER_BIT);
    GL.blendFunc(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA);
    backgroundTexture.bind_toSampler(0);
    VBO.draw_quad(true);

    // draw render texture:
    if (_picked.drawnObject){
      Shaders.set('shp_ARcutArea');
      _textures.render.bind_toSampler(0);
      
      Shaders.set_uniformDynamic2f('uun_dxy', _picked.dx, _picked.dy);
      Shaders.set_uniformDynamic1f('uun_ds', _picked.ds);
      Shaders.set_uniformDynamic1f('uun_s0', _dims.inputWidth / _dims.renderWidth);
      VBO.draw_quad(true);
    }

    GL.disable(GL.BLEND);
  }


  function update_output(){
    // BUILD THE EXPECTED OUTPUT:
    _objects.pos.forEach(function(obj){
      if (!obj){
        return;
      }

      const x = obj.xOutput;
      const y = obj.yOutput;      
      
      const isYaw = (obj.rot!==false && _move.outputAngles.yaw);
      const isHere = (obj === _picked.drawnObject);
      
      let yawNormalized = 0.0;
      if (isYaw){
        yawNormalized = (_picked.theta - Math.PI) / Math.PI; // between -1 and 1
      } 
      if (!isHere || !isYaw){
        yawNormalized = 0.0;
      }
      
      // here:
      fill_outputArr(_expectedArr, x, y, 0, (isHere) ? 1.0 : 0.0);
      fill_outputArr(_deltaMaskArr, x, y, 0, 1.0);
      fill_outputArr(_clampMaskArr, x, y, 0, 1.0);

      // notHere or 1st yaw component:
      let val = (isHere) ? 0.0 : 1.0; // = notHere
      let valMask = 1;
      if (_move.splitYawComponents) {
        val = (isHere && isYaw) ? Math.cos(Math.PI * yawNormalized) : 0;
        valMask = (isHere && isYaw) ? 1 : 0
      }
      fill_outputArr(_expectedArr, x, y, 1, val);
      fill_outputArr(_deltaMaskArr, x, y, 1, valMask);
      fill_outputArr(_clampMaskArr, x, y, 1, (_move.splitYawComponents) ? 0.0 : 1.0);

      // yaw or 2nd yaw component:
      val = yawNormalized;
      if (_move.splitYawComponents){
        val = Math.sin(Math.PI * yawNormalized);
      }
      fill_outputArr(_expectedArr,x,y, 2,(isHere && isYaw) ? val : 0.0);
      fill_outputArr(_deltaMaskArr,x,y,2, (isHere && isYaw) ? 1.0 : 0.0);

      // dx:
      fill_outputArr(_expectedArr,x,y, 3, (isHere) ? _picked.dxNormalized : 0.0);
      fill_outputArr(_deltaMaskArr,x,y,3, (isHere) ? 1 : 0);

      // dy:
      fill_outputArr(_expectedArr,x,y, 4, (isHere) ? _picked.dyNormalized : 0.0);
      fill_outputArr(_deltaMaskArr,x,y,4, (isHere) ? 1 : 0);

      // ds:
      fill_outputArr(_expectedArr,x,y, 5, (isHere) ? _picked.dsNormalized : 0.0);
      fill_outputArr(_deltaMaskArr,x,y,5, (isHere) ? 1 : 0);

      // roll:
      if (_move.outputAngles.roll){
        const roll = (_move.rotZ.angleMaxRad === 0) ? 0 : _move.rotZRad / _move.rotZ.angleMaxRad; //in [-1,1]
        fill_outputArr(_expectedArr,x,y,  6, (isHere) ? roll : 0.0);
        fill_outputArr(_deltaMaskArr,x,y, 6, (isHere) ? 1 : 0);
      }

      // pitch:
      if (_move.outputAngles.pitch){
        const dPhiRangeRad = _move.phiRangeRad[1] - _move.phiRangeRad[0];
        const phiNormalized = (dPhiRangeRad === 0)? 0 : (_picked.phi - _move.phiRangeRad[0])/ (dPhiRangeRad); //in [0,1]
        const pitch = phiNormalized * 2.0 - 1.0; //in [-1,1]
        fill_outputArr(_expectedArr,x,y, 7, (isHere) ? pitch : 0.0);
        fill_outputArr(_deltaMaskArr,x,y,7,(isHere) ? 1 : 0);
      }
    }); // end loop on  _objects.pos

    //console.log('CHECK _expectedArr'); lib_array.check_floatingSpecials(_expectedArr);
    //console.log('CHECK _deltaMaskArr'); lib_array.check_floatingSpecials(_deltaMaskArr);

    _textures.expected.update();
    _textures.deltaMask.update();

    if (_counter === 0){
      _textures.clampMask.update();
    }
  }


  function build_debugInfos(){
    const infos = {
      label: _picked.label
    };  

    if (infos.label!=='NONE'){
      if (_move.outputAngles.yaw){
        infos.yaw = lib_maths.reduce_significance(_picked.theta, 2);
      }
      if (_move.outputAngles.pitch){
        infos.pitch = lib_maths.reduce_significance(_picked.phi, 2);
      }
      if (_move.outputAngles.roll){
        infos.roll = lib_maths.reduce_significance(_move.rotZRad, 2);
      }
      infos.dx = lib_maths.reduce_significance(_picked.dxNormalized, 2);
      infos.dy = lib_maths.reduce_significance(_picked.dyNormalized, 2);
      infos.ds = lib_maths.reduce_significance(_picked.dsNormalized, 2);
    }
  }


  function build_randomizationAreas(randomizationAreas){
    _randomizationAreas.isEnabled = true;
    _randomizationAreas.container = new THREE.Object3D();
    // create geometries:
    _randomizationAreas.geometries = [
      new THREE.BoxGeometry( 1, 1, 1 ),
      new THREE.BoxGeometry( 0.5, 1, 1 ),
      new THREE.BoxGeometry( 0.0, 0.5, 1 ),
      new THREE.SphereGeometry( 0.5, 16, 8),
      new THREE.CylinderGeometry( 0.5, 0.5, 1, 8 ),
      new THREE.CylinderGeometry( 0.5, 0, 1, 8 )
    ];
    _randomizationAreas.areas = randomizationAreas;
    _randomizationAreas.areas.forEach(function(area){
      const meshes = [];
      for (let i=0; i<area.objectsCount; ++i){
        const mat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(Math.random(), Math.random(), Math.random())
        });
        const mesh = new THREE.Mesh(lib_array.pick_random(_randomizationAreas.geometries), mat);
        meshes.push(mesh);
        _randomizationAreas.container.add(mesh);
      }
      area.built = {
        meshes: meshes,
        size: new THREE.Vector3().fromArray(area.size)
      }
    });
  }


  function update_randomizationAreas(){
    if (!_randomizationAreas.isEnabled){
      return;
    }
    if (_counter % _randomizationAreas.updatePeriod === 0){
      _randomizationAreas.areas.forEach(update_randomizationArea);
    }
    if (_picked.drawnMesh && _picked.drawnObject){
      _picked.drawnMesh.add(_randomizationAreas.container);
    }
  }


  function update_randomizationArea(area){
    area.built.meshes.forEach(function(mesh){
      // randomize position:
      mesh.position.fromArray(area.center);
      mesh.position.x += area.built.size.x * (Math.random() - 0.5);
      mesh.position.y += area.built.size.y * (Math.random() - 0.5);
      mesh.position.z += area.built.size.z * (Math.random() - 0.5);

      // randomize rotation:
      mesh.rotation.set(Math.random()*6.28, Math.random()*6.28, Math.random()*6.28);

      // randomize scale:
      const s = lib_random.get_floatInRange(area.objectsSizeRange);
      mesh.scale.set(s,s,s);
    });
  }


  const that = {
    /*
      init specs are directly given from the training script
      * [<float>min,<float>max] phiRange: camera vt angle range in degrees. 1st value->vertical, 2nd -> hzt
      * [<float> dxMax, <float> dyMax, <float> dsMax] translationScalingFactors 1-> 100% of the input size
      * [<obj|string>, <obj|string>, <obj|string>] translationScalingFactorsDistributions
      * <float> aspectRatio: aspect ratio of the output. default: 1
      * <float> detectedObjScoreMin: output score to consider an object as detected. default: 0.5
      * <float> FOV: camera fov in degrees, or range. default: 40,
      * <int> width: width of the render. default: 256,
      * <bool> debug: false/undefined or one of these following values: 'CANVAS'
      * <func> onload: onload callback,
      * <WebGlContext> glContext: WebGL context if shared context, false otherwise
      * <int> updatePointLightsPeriod: update point lights each * generations
        * <object> objects: objects array. Each object has these parameters:
           * <string> label: label of the object,
           * <float> distance: detection distance,
           * [<string>] envMapMats: array of materials names where to apply an envmap,
           * trainingSets: array of objects:
              * [<string>] meshes: array of meshes, in .OBJ file format,
              * [ThreeMeshMaterial], materials: array of possible materials. All materials should be compatible with all meshes, otherwise split the trainingSet,
              * <dict> materialsTweakers: dict of functions to apply to materials. Keys are either materials names, either 'ALL',
              * <dict> meshesTweakers: dict of functions to apply to meshes. Keys are either meshes names, either 'ALL',
              * <float> scale: scale to apply to the object,
              * [<string>] textureImages: array of images to apply randomly as diffuse texture (.map) to the specified materials
              * [<float>, <float>] thetaRange: randomize rotation of the object around vertical axis (yaw), in degrees
              * <float> thetaOffset: add an offset to the angle around vertical axis (yaw), in degrees
  
          * <float> positiveProbability: probability to show an object (default: 1)   
      * <bool> outputYaw: if output yaw or not ( = theta)
      * <bool> outputRoll: if output roll or not ( = rotZ)
      * <bool> outputPitch: if output pitch or not ( = phi)      
      each mesh should be centered on (0,0,0), which is the center of the plane
    
    */
    init: function(spec){
      _isSharedContext = (spec.glContext && spec.isSharedContext) ? true : false;
      _positiveProbability = (spec.positiveProbability) ? spec.positiveProbability : 1;
      _dims.inputWidth = (spec.width) ? spec.width : 256; // width of the input of the NN
      _cameraParams.FOV = (spec.FOV) ? spec.FOV : 40;
      _move.translationScalingFactors = spec.translationScalingFactors || [0, 0, 0];
      _move.translationScalingFactorsDistributions = spec.translationScalingFactorsDistributions || ['uniform', 'uniform', 'uniform'];
      _move.rotZ.angleMaxRad = (spec.rotZ) ? spec.rotZ.max * _d2r : 0;
      _move.rotZ.nSigmas = (spec.rotZ && spec.rotZ.nSigmas) ? spec.rotZ.nSigmas : 1;

      _trainingDataRoot = spec.trainingDataRoot || '';
      
      if (spec.updatePointLightsPeriod){
        _lighting.updatePointLightsPeriod = spec.updatePointLightsPeriod;
      }
      _counter = 0, _lighting.maxDistance = 0;

      if (spec.phiRange){
        _move.phiRangeRad[0] = spec.phiRange[0] * _d2r;
        _move.phiRangeRad[1] = spec.phiRange[1] * _d2r;
      }
      if (spec.ambientLightIntensityRange){
        _lighting.ambientIntensityRange[0] = spec.ambientLightIntensityRange[0];
        _lighting.ambientIntensityRange[1] = spec.ambientLightIntensityRange[1];
      }
      if (spec.pointLightNumberRange){
        _lighting.pointLightNumberRange[0] = spec.pointLightNumberRange[0];
        _lighting.pointLightNumberRange[1] = spec.pointLightNumberRange[1];
      }
      _lighting.pointLightMaxIntensity = (typeof(spec.pointLightMaxIntensity)==='undefined') ? _settings.pointLightMaxIntensity : spec.pointLightMaxIntensity;
      
      _move.outputAngles = {
        yaw: (typeof(spec.outputYaw)==='undefined') ? true : spec.outputYaw,
        roll: (typeof(spec.outputRoll)==='undefined') ? true : spec.outputRoll,
        pitch: (typeof(spec.outputPitch)==='undefined') ? true : spec.outputPitch
      };

      _move.splitYawComponents = (spec.splitYawComponents) ? true : false;
      _move.usedOutputOffsets.splice(0);
      _move.usedOutputOffsets.push(0, 1, 3, 4, 5);
      if (_move.outputAngles.yaw) _move.usedOutputOffsets.push(2);
      if (_move.outputAngles.roll) _move.usedOutputOffsets.push(6);
      if (_move.outputAngles.pitch) _move.usedOutputOffsets.push(7);


      _testing.detectedObjScoreMin = (typeof(spec.detectedObjScoreMin)==='undefined') ? 0.5 : spec.detectedObjScoreMin;
      
      // each output parameters are vertical sticks of 8 pixels height:
      const posObjects = spec.objects.filter(function(obj){
        return obj.label;
      });
      _dims.outputWidth = that.compute_outputSize(posObjects.length);
      console.log('INFO in ObjectDetectionTrainer.init(): computed outputWidth =', _dims.outputWidth);

      const nOut = _dims.outputWidth * _dims.outputWidth * 4;
      _deltaMaskArr = new Uint8Array(nOut);
      _clampMaskArr = new Uint8Array(nOut);
      _expectedArr  = new Float32Array(nOut);

      _cameraParams.aspectRatio = spec.aspectRatio || 1.0;
      
      // randomization areas:
      if (spec.randomizationAreas && spec.randomizationAreas.length){
        _randomizationAreas.updatePeriod = spec.randomizationAreasUpdatePeriod || 200;
        build_randomizationAreas(spec.randomizationAreas);
      }

      // width of the threejs render, which will be scaled and cropped according to _move.translationScalingFactors
      // after scaling/cropping, the final width will be _dims.inputWidth:
      const dxyMax = Math.max(_move.translationScalingFactors[0], _move.translationScalingFactors[1]);
      _dims.renderWidth = Math.round(_dims.inputWidth * (1+_move.translationScalingFactors[2]) * (1+dxyMax));

      // init textures:
      _textures.input = Texture.instance({
        'isFloat': false,
        'isLinear': true,
        'isMipmap': true,
        'isPot': true,
        'width': _dims.inputWidth
      });
      _textures.expected = Texture.instance({
        'isFloat': true,
        'width': _dims.outputWidth,
        'array': _expectedArr
      });
      _textures.deltaMask = Texture.instance({
        'isFloat': false,
        'width': _dims.outputWidth,
        'array': _deltaMaskArr
      });
      _textures.clampMask = Texture.instance({
        'isFloat': false,
        'width': _dims.outputWidth,
        'array': _clampMaskArr
      });

      // build the canvas:
      let threeCanvas = null;
      if (!_isSharedContext){
        threeCanvas = document.createElement('canvas');
        threeCanvas.width = _dims.renderWidth;
        threeCanvas.height = _dims.renderWidth;
        if (spec.debug==='CANVAS'){
          document.body.appendChild(threeCanvas);
          threeCanvas.style.position = 'absolute';
          threeCanvas.style.zIndex = '2000';
          threeCanvas.style.border = '2px solid red';
          threeCanvas.style.bottom = '0px';
          threeCanvas.style.left = '0px';
        }
        _textures.render = Texture.instance({
          'isFloat': false,
          'width': _dims.renderWidth,
          domElement: threeCanvas,
          'isLinear': true
        });
      }

      const rendererOptions = {
        antialias: !_isSharedContext,
        alpha: true
      };
      if (_isSharedContext){
        rendererOptions.context = spec.glContext;
      } else {
        rendererOptions.canvas = threeCanvas;
      }
      _three.renderer = new THREE.WebGLRenderer(rendererOptions);
      //_three.renderer.gammaFactor = 2.2;
      
       // improve WebGLRenderer settings:
      //_three.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      //_three.renderer.outputEncoding = THREE.sRGBEncoding;

      if (_isSharedContext){
        _three.renderer.setSize( _dims.renderWidth, _dims.renderWidth );
        const threeRenderTarget = new THREE.WebGLRenderTarget(_dims.renderWidth, _dims.renderWidth,
          { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat } );
        _three.renderer.setRenderTarget(threeRenderTarget);
        _textures.render = Texture.instance({
          'isFloat': false,
          'width': _dims.renderWidth,
          'isLinear': true,
          'isPot': false
        });
        _three.composer = new THREE.EffectComposer(_three.renderer, threeRenderTarget);
      } else {
        _three.composer = new THREE.EffectComposer(_three.renderer);
      }

      // build loading manager:
      _three.loadingManager = new THREE.LoadingManager();
      _three.loadingManager.onLoad = function(){
        if (_isFatalError){
          return;
        }
        console.log('INFO in ObjectDetectionTrainer: _three.loadingManager has loaded everything');
        check_isLoaded('THREE');
      }
      _three.loadingManager.onError = function(err){
        if (_isFatalError){
          return;
        }
        _isFatalError = true;
        console.log('ERROR in ObjectDetectionTrainer: ' + err + ' not found');
      }
      
       // build the scene:
      _three.scene = new THREE.Scene();

      // get debug texture
      _three.debugTexture = new THREE.TextureLoader(_three.loadingManager).load('images/debug/debugTexture.jpg');

      // build the camera:
      const fov = (typeof(_cameraParams.FOV) === 'number') ? _cameraParams.FOV : _cameraParams.FOV[0];
      _three.camera = new THREE.PerspectiveCamera(fov, _cameraParams.aspectRatio, 0.1, 1000 );

      // build the effect composer:
      _three.renderer.autoClear = false;
      const threeRenderPass = new THREE.RenderPass( _three.scene, _three.camera );
      _three.composer.addPass(threeRenderPass );

      const postprocessingPass =  new THREE.ShaderPass( THREE.CopyShader );
      postprocessingPass.renderToScreen = !_isSharedContext;
      _three.composer.addPass(postprocessingPass);

      _three.origin = new THREE.Vector3(0, 0, 0);

      // load textures if necessary:
      if (spec.noiseTextures){
        load_textures(spec.noiseTextures, _noiseTextures);
      }

      // build a plane for 2D rendering:
      const planeGeom = new THREE.PlaneGeometry(2,2); //X and Y go from -1 to 1 (size 2)
      const vertexShaderSource = "attribute vec3 position;\n\
        uniform vec2 sampleUV, sampleDUV;\n\
        uniform float rotZ;\n\
        varying vec2 vUV;\n\
        void main(void){\n\
          gl_Position = vec4(position.xy, 0., 1.);\n\
          vec2 uvCentered=position.xy;\n\
          float c = cos(rotZ);\n\
          float s = sin(rotZ);\n\
          vec2 uvRotated = mat2(c,s,-s,c) * uvCentered;\n\
          vec2 uv = vec2(0.5,0.5) + 0.5 * uvRotated;\n\
          vUV = sampleUV + uv * sampleDUV;\n\
        }";
      const fragmentShaderSource = "precision lowp float;\n\
        uniform sampler2D samplerImage;\n\
        varying vec2 vUV;\n\
        void main(void){\n\
          gl_FragColor = texture2D(samplerImage, vUV);\n\
        }";
      const planeMat = new THREE.RawShaderMaterial({
        depthWrite: false,
        depthTest: false,
        vertexShader: vertexShaderSource,
        fragmentShader: fragmentShaderSource,
        uniforms:{
          sampleUV: {value: new THREE.Vector2()},
          sampleDUV: {value: new THREE.Vector2()},
          samplerImage: {value: null},
          rotZ: {value: 0.0}
        }
      });
      _three.planeMesh = new THREE.Mesh(planeGeom, planeMat);
      
      // build the lights:
      _three.lights = {
        ambient: new THREE.AmbientLight( 0xffffff ),
        points: new Array(_settings.pointLightNumberRange[1])
      }
      for (let i=0; i<_three.lights.points.length; ++i){
        _three.lights.points[i] = new THREE.PointLight(0xffffff)
      }
      _three.scene.add(_three.lights.ambient);

      // loading management:
      _loading.nToLoad = 2; // init callback + _three.loadingManager cb
      _loading.nLoaded = 0; // number of objects to load
      _loading.onloadCallback = (spec.onload) ? spec.onload : false;

      // construct meshes and materials:
      _objects.all = spec.objects.map(function(obj){
        _lighting.maxDistance = Math.max(_lighting.maxDistance, obj.distance);
        obj.trainingSets = obj.trainingSets.filter(function(trainingSet){
          if ('probability' in trainingSet && trainingSet.probability <= 0){
            return false;
          }
          return true;
        });
        obj.trainingSets.forEach(load_trainingSet);
        return obj;
      });

      if (spec.envMaps){
        build_envMaps();
      }

      check_isLoaded('INIT');
    }, //end init()


    'compute_outputSize': function(nObjects){ // can be used in the training script to auto set the output layer size
      const widthPow2 = Math.log(8*nObjects) / Math.log(4);
      const outputWidth = Math.pow(2, Math.ceil(widthPow2));

      return Math.max(outputWidth, 8);
    },


    generate_sample: function(backgroundTexture, isTest){ // called by Trainer, standardized
      set_GLState();
      _three.sceneObjects.splice(0);          
      pick_random();

      if (_picked.drawnObject){
        // Z rotation (if 3D -> applied by the camera, if 2D -> plane rot in the shaders:
        _move.rotZRad = lib_random.get_normalClampedRelative(0, _move.rotZ.nSigmas, -_move.rotZ.angleMaxRad, _move.rotZ.angleMaxRad);
        
        // select a random training set:
        if (_picked.drawnTrainingSet){
          switch(_picked.drawnTrainingSet.type){
            case '3D':
              add_meshToScene();
              update_lighting();
              update_randomizationAreas();
              update_camera();
              break;

            case 'IMAGESATLAS':
              add_imageToScene(isTest);
              break;
          }
        }
      } //end if _picked.drawnObject

      render();
      crop_renderTexture(backgroundTexture);      
      update_output();
      unset_GLState();

      ++_counter;

      return ({
        infos: build_debugInfos(),
        input: _textures.input,
        expected: _textures.expected,
        deltaMask: _textures.deltaMask,
        clampMask: _textures.clampMask
      });
    },


    generate_testSample: function(backgroundTexture, testSampleIndex){ // used by Trainer, standardized
      const testSample = that.generate_sample(backgroundTexture, true);
      return testSample;
    },


    needs_testSubstractExpectedTexture: false,


    evaluate_test: function(NNresult){
      let detectedObj = null, detectedObjScore = _testing.detectedObjScoreMin;
      _objects.pos.forEach(function(obj){
        if (!obj) return;

        const x = obj.xOutput, y = obj.yOutput;

        // compute detection score:
        const scoreHere = get_resultPix(NNresult, x, y, 0);
        
        let scoreNotHere = 0;
        if (!_move.splitYawComponents){
          scoreNotHere = get_resultPix(NNresult, x, y, 1);
        }

        const score = scoreHere - scoreNotHere;
        
        // console.log(iPixHere, scoreHere, scoreNotHere, score);
        // compare score:
        if (score > detectedObjScore){
          detectedObjScore = score;
          detectedObj = obj;
        }       
      });//end loop on positive objects

      const detectedObjLabel = get_label(detectedObj);
      const drawnObjLabel = _picked.label;

      // is it a success or not:
      const isSuccess = (detectedObjLabel === drawnObjLabel);
      if (!isSuccess){
        console.log('INFO: NN detects ', detectedObjLabel, 'instead of', drawnObjLabel);
      }

      // classification error type:
      const isFalsePositive = !isSuccess && (drawnObjLabel === 'NONE');
      const isFalseNegative = !isSuccess && (detectedObjLabel === 'NONE');

      // compute continuous error:
      let error = 0.0;
      if (drawnObjLabel !== 'NONE'){
        let errorSq = 0.0;
        _move.usedOutputOffsets.forEach(function(outputOffset){
          const x = _picked.drawnObject.xOutput;
          const y = _picked.drawnObject.yOutput;
          const val = get_resultPix(NNresult, x, y, outputOffset);
          const expectedVal = get_outputArr(_expectedArr, x, y, outputOffset);
          const delta = val - expectedVal;
          errorSq += delta * delta;
        });
        error = Math.sqrt(errorSq);
      } else {
        error = -Infinity;
      }

      return {
        error: error,
        isConsider: true,
        success: isSuccess,
        isFalsePositive: isFalsePositive,
        isFalseNegative: isFalseNegative
      }     
    }, //end evaluate_test()


    get_evaluationType: function(){
      return 'MAXSUCCESSRATE_MINERROR';
    },


    get_backgroundWidth: function(){
      return _dims.inputWidth;
    },


    get_exportData: function(){
      const exportData = {
        // object specs:
        'distances': _objects.distances,
        'labels': _objects.labels,

        // IO format:
        'inputAspectRatio': _cameraParams.aspectRatio,
        'splitYawComponents': _move.splitYawComponents,
        'isYaw': _move.outputAngles.yaw,
        
        // movement amplitude:
        'pitchRange': _move.phiRangeRad,
        'rollMax': _move.rotZ.angleMaxRad,
        //'rzMax': _move.rotZ.angleMaxRad,
        'translationScalingFactors': _move.translationScalingFactors,
      };
      return exportData;
    }


    //PRECOMPILER_BEGINDELETE
    ,get_displayableTextures: function(){
      return [
        {
          texture: function(){ return _textures.input; },
          name: 'input',
          renderingMode: 'color'
        },
        {
          texture: function(){ return _textures.render; },
          name: 'render',
          renderingMode: 'color'
        },
        {
          texture: function(){ return _textures.expected; },
          name: 'expected'
        },
        {
          texture: function(){ return _textures.deltaMask; },
          name: 'deltaMask'
        },
        {
          texture: function(){ return _textures.clampMask; },
          name: 'clampMask'
        }
      ];
    }
    //PRECOMPILER_ENDDELETE
  }; //end that
  return that;
})();
