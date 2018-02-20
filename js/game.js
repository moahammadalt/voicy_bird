var bird;
var score;
var game_area;
var game_intro;
var game_intro_text;
var game_intro_text1;
var obstacles = [];
var score_count = 0;
var is_stoped = false;
var start_playing = false;
var foo = new p5.SpeechRec('en-US', get_voice_recognizer); // speech recognition object (will prompt for mic access)
foo.start(true, false); // start listening

function startGame() {
  if(get_cookie('score') == ''){
    set_cookie('score', 0, 30);
  }
  bird = new component(30, 30, "https://lookinmena.com/wp-content/uploads/2018/02/Flappy_Birddd.png", 60, 120, "image");
  bird.gravity = 0.05;
  score = new component("20px", "Consolas", "black", 375, 35, "text");
  game_explain = new component("18px", "Consolas", "#772e2c", 15, 100, "text", false);
  game_intro.start();
}

var game_intro = {
  canvas : document.createElement("canvas"),
  start : function() {
    game_intro_text = new component("15px", "Consolas", "black", 15, 100, "text", false, 'game_intro');
    game_intro_text1 = new component("25px", "Consolas", "#772e2c", 380, 100, "text", false, 'game_intro');
    game_intro_text2 = new component("15px", "Consolas", "black", 15, 140, "text", false, 'game_intro');
    game_intro_text3 = new component("20px", "Consolas", "#772e2c", 380, 140, "text", false, 'game_intro');
    game_intro_text4 = new component("9px", "Consolas", "#772e2c", 10, 20, "text", false, 'game_intro');
    high_score_text = new component("25px", "Consolas", "#772e2c", 150, 60, "text", false, 'game_intro');
    this.canvas.width = 500;
    this.canvas.height = 270;
    this.context = this.canvas.getContext("2d");
    document.body.insertBefore(this.canvas, document.body.childNodes[0]);
    this.frameNo = 0;
    high_score_text.text = `Best Score: ${get_cookie('score')}`;
    game_intro_text.text = `To start playing click on the screen or say`;
    game_intro_text1.text = `"Play"`;
    game_intro_text2.text = `to pause the game click on the screen or say`;
    game_intro_text3.text = `"Stop"`;
    game_intro_text4.text = `Note: to be able to play this game you should allow microphone permession in your browser`;
    update_game_intro();
  },
  clear : function() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

function update_game_intro() {
  game_intro.clear();
  game_intro.frameNo += 1;
  game_intro_text.update();
  game_intro_text1.update();
  game_intro_text2.update();
  game_intro_text3.update();
  game_intro_text4.update();
  high_score_text.update();
}

var game_area = {
  canvas : document.createElement("canvas"),
  start : function() {
    game_intro.clear();
    var el = document.querySelector( 'canvas' );
    el.parentNode.removeChild( el );
    this.canvas.width = 500;
    this.canvas.height = 270;
    this.context = this.canvas.getContext("2d");
    this.interval = setInterval(updateGameArea, 20);
    document.body.insertBefore(this.canvas, document.body.childNodes[0]);
    this.frameNo = 0;
    this.score = 0;
    score.text="SCORE: " + game_area.score;
    game_explain.text = `Screem to the microphone to control the bird`;
  },
  clear : function() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}


function component(width, height, color, x, y, type, dir, obj) {
  
  this.type = type;
  this.score = 0;
  this.width = width;
  this.height = height;
  this.speedX = 0;
  this.speedY = 0;    
  this.x = x;
  this.y = y;
  this.gravity = 0;
  this.gravitySpeed = 0;
  if(obj == 'game_intro'){
    game_obj = game_intro;
  }
  else{
    game_obj = game_area;
  }
  this.update = function() {
    ctx = game_obj.context;
    if (this.type == "text") {
      ctx.font = this.width + " " + this.height;
      ctx.fillStyle = color;
      ctx.fillText(this.text, this.x, this.y);
    } 
    else if(type == "image"){
      this.image = new Image();
      this.image.src = color;
      if(dir){
        ctx.drawImage(this.image, 
        this.x, this.y,
        this.image.naturalWidth, this.image.naturalHeight);
      }
      else{
        ctx.drawImage(this.image, 
        this.x, this.y,
        this.width, this.height);
      }
    }
    else {
      ctx.fillStyle = color;
      ctx.fillRect(this.x, this.y, this.width, this.height);
    }
  }

  this.newPos = function() {
    this.gravitySpeed = this.gravity;
    this.x += this.speedX;
    this.y += this.speedY + this.gravitySpeed;
    this.hitBottom();
    this.hitUp();
  }

  this.hitBottom = function() {
    var rockbottom = game_obj.canvas.height - this.height;
    if (this.y > rockbottom) {
      this.y = rockbottom;
      this.gravitySpeed = 0;
    }
  }

  this.hitUp = function() {
    if (this.y < -5) {
      this.y = -5;
      this.gravitySpeed = 0;
    }
  }

  this.crashWith = function(otherobj) {
    var myleft = this.x;
    var myright = this.x + (this.width);
    var mytop = this.y;
    var mybottom = this.y + (this.height);
    var otherleft = otherobj.x;
    var otherright = otherobj.x + (otherobj.width);
    var othertop = otherobj.y;
    var otherbottom = otherobj.y + (otherobj.height);
    var crash = true;
    if ((mybottom < othertop+4) || (mytop > otherbottom-7) || (myright < otherleft+3) || (myleft > otherright)) {
      crash = false;
    }
    if(myright == otherright){
      if(score_count === 0){
        score_count += 1;
        score.text="SCORE: " + (game_obj.score + score_count);
      }
      else{
        score_count += 1;
        score.text="SCORE: " + (game_obj.score + score_count/2);
      }
    }
    return crash;
  }
}

function updateGameArea(m) {
    var x, height, gap, minHeight, maxHeight, minGap, maxGap;
    for (i = 0; i < obstacles.length; i += 1) {
      if (bird.crashWith(obstacles[i])) {

        lose_text = new component("25px", "Consolas", "#772e2c", 170, 100, "text", false);
        lose_text.text = `game over`;

        lose_text.update();

        clearInterval(game_area.interval);

        setTimeout(function(){
          is_stoped = false;
          start_playing = false;
          obstacles = [];
          if(score_count > get_cookie('score')){
            set_cookie('score', score_count/2, 30)
          }
          score_count = 0;
          clearInterval(game_area.interval);
          game_area.clear();
          var el = document.querySelector( 'canvas' );
          el.parentNode.removeChild( el );
          startGame();
        }, 3000);

        return;
      } 
    }

    game_area.clear();
    game_area.frameNo += 1;

    if (game_area.frameNo == 1 || everyinterval(200)) {
      x = game_area.canvas.width;
      minHeight = 70;
      maxHeight = 110;
      height = Math.floor(Math.random()*(maxHeight-minHeight+1)+minHeight);
      minGap = 80;
      maxGap = 100;
      gap = Math.floor(Math.random()*(maxGap-minGap+1)+minGap);
      obstacles.push(new component(50, height, "https://lookinmena.com/wp-content/uploads/2018/02/Asset-1111.png", x, 0, "image"));
      obstacles.push(new component(50, x - height - gap, "https://lookinmena.com/wp-content/uploads/2018/02/Asset-5.png", x, height + gap, "image", true));
    }
    for (i = 0; i < obstacles.length; i += 1) {
      obstacles[i].x += -1;
      obstacles[i].update();
    }
    if(game_area.frameNo < 200){
      game_explain.update();
    }
    score.update();
    bird.newPos();
    bird.update();
}

function everyinterval(n) {
  if ((game_area.frameNo / n) % 1 == 0) {
    return true;
    
  }
  return false;
}

function accelerate(n) {
  bird.gravity = n;
}

var mic = new p5.AudioIn();
mic.start();
var diff = [];

window.setInterval(function(){
  var sound = mic.getLevel();
  if((sound * 10) < 0.1){
    accelerate(1);
  }
  else {
    if(diff.length < 60){
      diff.push((sound * 10));
    }
    else{
      diff = [];
    }
    accelerate(-(sound * 5))
  }
}, 20);


function get_voice_recognizer(){
  if(foo.resultString == 'play' && !start_playing){
    game_area.start();
    start_playing = true;
    is_stoped = false;
  }
  if(foo.resultString == 'continue' && start_playing){
    game_area.interval = setInterval(updateGameArea, 20);
    is_stoped = false;
  }
  if(foo.resultString == 'stop'){
    pause_text = new component("15px", "Consolas", "#772e2c", 10, 30, "text", false);
    pause_text.text = `say "continue" to back to the game`;
    new_game_text = new component("15px", "Consolas", "#772e2c", 10, 60, "text", false);
    new_game_text.text = `say "new game" or "restart" to restart the game`;
    pause_text.update();
    new_game_text.update();
    clearInterval(game_area.interval);
    is_stoped = true;
  }
  if(foo.resultString == 'restart' || foo.resultString == 'new game'){
    is_stoped = false;
    start_playing = false;
    obstacles = [];
    score_count = 0;
    clearInterval(game_area.interval);
    game_area.clear();
    var el = document.querySelector( 'canvas' );
    el.parentNode.removeChild( el );
    startGame();
  }
}

game_intro.canvas.addEventListener('click', function() { 
  game_area.start();
}, false);

game_area.canvas.addEventListener('click', function() {
  if(!is_stoped){
    pause_text = new component("15px", "Consolas", "#772e2c", 10, 30, "text", false);
    pause_text.text = `say "continue" to back to the game`;
    new_game_text = new component("15px", "Consolas", "#772e2c", 10, 40, "text", false);
    new_game_text.text = `say "new game" or "restart" to restart the game`;
    pause_text.update();
    new_game_text.update();
    clearInterval(game_area.interval);
    is_stoped = true;
  }
  else{
    game_area.interval = setInterval(updateGameArea, 20);
    is_stoped = false;
  }
}, false);

function set_cookie(cname, cvalue, exdays) {
  var d = new Date();
  d.setTime(d.getTime() + (exdays*24*60*60*1000));
  var expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function get_cookie(cname) {
  var name = cname + "=";
  var decodedCookie = decodeURIComponent(document.cookie);
  var ca = decodedCookie.split(';');
  for(var i = 0; i <ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) == ' ') {
          c = c.substring(1);
      }
      if (c.indexOf(name) == 0) {
          return c.substring(name.length, c.length);
      }
  }
  return "";
}
