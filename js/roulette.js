var mymap = L.map('mapid');

const gsi_blank = new L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png', {
  attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>地理院タイル白地図</a>",
  opacity:0.9,
  maxZoom: 7
}).addTo(mymap);

const gsi_map = new L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
  attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>地理院タイル標準地図</a>",
  opacity:0.7,
  maxZoom: 7
});
mymap.fitBounds([[45.30,126.50],[23.00,143.00]])

const style = (feature) => {
  return {
    // stroke:false,
    stroke:true,
    color: '#666',
    weight: 0.5,
    fillOpacity: 0.8,
    fillColor:'gray'
    };
}

const highlightFeature = (e) => {//マウスホバーしたポリゴンに対して境界線の強調表示を行う
  var layer = e.target;

  layer.setStyle({//マウスホバーしたら太字の枠線をつける
    stroke:true,
    color: '#666',
    weight:3
    // fillOpacity: 1,
  });
  if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
    layer.bringToFront();
  }
}

const resetHighlight = (e) => {
  geojson.setStyle({
    // stroke:false,
    weight:0.5
  });
  // info.update();
}
const zoomToFeature = (e) => {// クリックした都道府県を全体表示してズーム
  geojson.setStyle({
    fillOpacity:0.6,
    // stroke:false
  })
  e.target.setStyle({
    fillOpacity:0.2,
    stroke:true
  })
  window.setTimeout(()=> {//少しだけタイムラグをつけてあげないと表示が同時に行われてしまう。
    mymap.fitBounds([[e.target._bounds._northEast.lat,e.target._bounds._northEast.lng],[e.target._bounds._southWest.lat,e.target._bounds._southWest.lng]]);
  },100)
}


const onEachFeature = (feature, layer) => {
  layer.on({
    mouseover: highlightFeature,//強調表示する
    mouseout: resetHighlight,//強調表示を消す
    click: zoomToFeature//クリックしたらズームして特定のポリゴンの強調表示
  });
  if(feature.properties && feature.properties.name){
    layer.bindPopup(feature.properties.name);
  }
}

let prefectureClick = null;

geojson = L.geoJSON(prefecturesPoly, {//ポリゴンデータの読み込み
  style: style,
  onEachFeature: onEachFeature
}).addTo(mymap);
// console.log(geojson)


const Map_BaseLayer = {//basemapの切り替え
  '地理院地図': gsi_map,
  '白地図': gsi_blank,
};

const Map_AddLayer = {
};

L.control.layers(Map_BaseLayer, Map_AddLayer,{
  collapsed: false,
}).addTo(mymap);

L.control.zoomLabel({position: 'bottomleft'}).addTo(mymap);

const fitlayer = () => {//全体表示
  const fitBtnEvent = document.getElementById('zoomstyle');
  fitBtnEvent.addEventListener('click', () => {
    mymap.fitBounds([[45.30,126.50],[23.00,143.00]])
  })
}
fitlayer();

class SelectClass {
  constructor(){
    this.cityList =[];
    this.roulette = null;
    this.text = null;
    this.jsonObj = null;
    this.selectCity = null;
  };

  makeCityList (){//geojsonから都道府県名を取得してリスト化
    this.prefNamesBefore = prefecturesPoly.features.map(feature => {
      return feature.properties.name
    })
    this.cityList = this.prefNamesBefore.filter(function (x, i, self) {//重複を削除
      return self.indexOf(x) === i;
    });
    this.cityLastList = this.cityList.slice();
    // console.log(this.cityLastList)
  };
  
  selectPrefectures () {
    this.roulette = document.getElementById('roulette');
    this.selectNum = Math.floor(Math.random() * this.cityList.length);//都道府県コードをランダム
    this.selectCity = String(this.cityList[this.selectNum]);//選ばれた都道府県名をリストから文字列で変数に代入
    this.roulette.textContent = `${this.selectCity}`;//県名を画面に表示させる。
  };

  lastSelectpref(){
    this.roulette = document.getElementById('roulette');//答えが同じものが出ない様に調整
    this.selectLastCity = this.cityLastList.splice(Math.floor(Math.random() * this.cityLastList.length),1)[0];//都道府県コードをランダム
    this.roulette.textContent = `${this.selectLastCity}`;//県名を画面に表示させる。
  }
  
  checkLastCityList(){
    if(this.cityLastList.length === 0){
      this.cityLastList = this.cityList.slice();
    }
  }

  changeColorLastSelectPoly () {//答えが同じものが出ない様に調整
    this.lastSelectpref()
    geojson.eachLayer(layer => {
      if(layer.feature.properties.name == this.selectLastCity){
        // console.log('レイヤー：'+layer.feature.properties.name)
        // console.log('文字表示２：'+this.selectCity)
        layer.setStyle({
          fillColor:'red',
          fillOpacity:1,
          // stroke:false
        })
      }
    }) 
  }


  viewLastPref(){
    this.roulette = document.getElementById('roulette');
    this.roulette.textContent = '答え： ' + `${this.selectLastCity}`;//県名を画面に表示させる。
  }

  changeColorSelectPoly () {//ランダムに都道府県を選んでその属性と同じポリゴンの色を変える。
    this.selectPrefectures ()
    geojson.eachLayer(layer => {
      if(layer.feature.properties.name == this.selectCity){
        // console.log('レイヤー：'+layer.feature.properties.name)
        // console.log('文字表示２：'+this.selectCity)
        layer.setStyle({
          fillColor:'red',
          fillOpacity:1,
          // stroke:false
        })
      }
    }) 
  }

  clearColorSelectPoly () {//つけた色を消す
    geojson.setStyle({
      // stroke:false,
      weight: 0.5,
      fillOpacity: 0.6,
      fillColor:'gray'
    })
  }

  clearRouletteText(layer){
    this.roulette.textContent = ``;//県名を一旦消す。
    geojson.eachLayer(layer => {
      if(layer.feature.properties.name == this.selectLastCity){
        mymap.fitBounds([[layer._bounds._northEast.lat*0.99,layer._bounds._northEast.lng*1.01],[layer._bounds._southWest.lat*1.01,layer._bounds._southWest.lng*0.99]]);//セレクトされた都道府県をズーム
      }
    })
  }

  countDown () {
    this.totalTime = 5000;
    this.oldTime = Date.now();
    this.timeId = setInterval(() => {
      this.currentTime = Date.now();
      this.diff = this.currentTime - this.oldTime;// 差分を求める
      this.diffSec = this.totalTime - this.diff;
      this.remainSec = Math.ceil(this.diffSec / 1000);//ミリ秒を整数に変換
      this.text = `${this.remainSec}`;
      if (this.diffSec <= 0) {// 0秒以下になったら
        clearInterval(this.timeId);
        this.text = "";// タイマー終了
      }
      document.querySelector('#count_down').innerHTML = this.text;  // 画面に表示する
    })
  }
}

const selectCtyInstance = new SelectClass();
selectCtyInstance.makeCityList();

//音の読み込み
const musicIntro = new Audio('audio/intro_part2.mp3');
const musicSelected = new Audio('audio/select_part2.mp3')
const musicCountDown =new Audio('audio/think_part2.mp3')

class AudioClass {
  constructor(){
    this.speacker = document.getElementById('speaker_icon')//スピーカーのアイコンの読み込み
    this.loop = null;
    this.vl = 0.3
    this.btn = document.getElementById('btn_id')
    this.speacker.addEventListener('click', () => {
      clearInterval(this.loop);
      musicIntro.pause();
      if (this.speacker.className === 'speaker_on'){
        this.offSpeaker()//disabledがtrueでもfalse でも同じなのでは判定はなし
      }else{
        if(this.btn.classList.contains('disabled') == true){
          this.onSpeaker();
        }else {
          this.onSpeaker();
          this.playIntroMusic();
        }
      }
    });

    this.btn.addEventListener('click', () => {//クリックしたらルーレットがはじまる。
      this.selectMusic();
      this.btn.classList.add('disabled')
      // this.btn.disabled = true;//ボタンdisable
      document.querySelector('#answer').innerHTML = ''
      this.interval = window.setInterval(() => {
        selectCtyInstance.clearColorSelectPoly();
        selectCtyInstance.changeColorSelectPoly();
      },80)
    
      window.setTimeout( () => {//カウントダウンが始まる
        clearInterval(this.interval)
        // voiceOn();
        // musicCountDown.play();
        selectCtyInstance.clearColorSelectPoly();
        selectCtyInstance.changeColorLastSelectPoly();
        selectCtyInstance.countDown();
        selectCtyInstance.clearRouletteText();
        
        window.setTimeout(() => {//答えが出てもとに戻る
          this.btn.classList.remove('disabled');
          // this.btn.disabled = false;
          // selectCtyInstance.selectPrefectures();
          selectCtyInstance.viewLastPref();
          selectCtyInstance.checkLastCityList();
          mymap.fitBounds([[45.30,126.50],[23.00,143.00]])
          // recognition.stop()
          clearInterval(this.loop);
          if (this.speacker.className === 'speaker_on'){
            this.playIntroMusic();
          }
          // window.setTimeout(() => {
          //   this.btn.classList.remove('disabled');//musicCountdownが流れ終わったらボタンが復帰
          // },800);
        },5000);
      }, 2000);
    })
  }
  
  offSpeaker () {//実はオフにしても裏でイントロは流れている。
    this.speacker.classList.remove('speaker_on')
    this.speacker.src ='img/icon_120980_256.png'
    musicIntro.muted = true;
    this.typeCountMute();
  }
  
  onSpeaker () {
    this.speacker.classList.add('speaker_on')
    this.speacker.src ='img/icon_120970_256.png'
    this.typeCountVolUp();
  }
  
  playIntroMusic () {
    this.introOn();
    musicIntro.muted = false;
    musicIntro.volume = 0.1;
    this.loop = window.setInterval(()=> {
      // musicIntro.pause();
      this.introOn();
    // },36200)//intro.mp3の場合
    },8740)//intro_part2.mp3の場合(BPM110:4小節)
  }
  
  introOn () {
    musicIntro.currentTime = 0;
    musicIntro.play();
  }

  typeCountMute () {
    musicSelected.muted = true;
    musicCountDown.muted = true;
  }

  typeCountVolUp () {
    musicSelected.muted = false;
    musicCountDown.muted = false;
    musicSelected.volume = 0.25;
    musicCountDown.volume = 0.25;
  }

  selectMusicPlay(){
    musicSelected.currentTime = 0;
    musicSelected.play();
  }
  
  selectMusic () {
    musicIntro.muted = true;
    musicCountDown.play();
    musicCountDown.muted = true;
    this.selectMusicPlay();
    musicCountDown.pause();
    musicCountDown.currentTime = 0;
    if (this.speacker.className === 'speaker_on') {
      this.typeCountVolUp();
    }else{
      this.typeCountMute();
    }
    window.setTimeout(()=> {//musicCountDownが終わるタイミングとボタンの復帰をずらすためここにsettimeoutする。
      musicCountDown.play();
      // console.log("countdown１")
    },2000)
  }
}

const audio = new AudioClass();

//ここから音声認識
// SpeechRecognition = webkitSpeechRecognition || SpeechRecognition;
// if ('SpeechRecognition' in window) {
//   // ユーザのブラウザは音声合成に対応しています。
// } else {
//   // ユーザのブラウザは音声合成に対応していません。
// }
// const recognition = new SpeechRecognition();
// const voiceOn = () => {
//   recognition.onresult = (event) => {
//     this.speechpref = selectCtyInstance.cityList.filter( pref => {
//       return pref == event.results[0][0].transcript
//     });
//     if (speechpref == event.results[0][0].transcript){
//       document.querySelector('#answer').innerHTML = event.results[0][0].transcript
//     }
//   }
//   recognition.start();
// }
