
var fs = require('fs');
var express = require('express');
var app = express();
var httpApp = express();
var http = require('http');
var https = require('https');
var WebSocketServer = require('ws').Server;
var logstashModule = require('logstash-client');
var logstashClient;
var config = require('./server-config');

// Yes, SSL is required
var httpsServer = https.createServer(config.httpsConfig, app);
var httpServer = http.createServer(httpApp);
var io = require('socket.io')(httpsServer);
var request = require('request');

var stunrestanswer;
// ----------------------------------------------------------------------------------------


// app.use(express.static(__dirname + '/dist'));
app.use(express.static(__dirname + '/bower_components'));
app.use('/pix',express.static(__dirname + '/pix'));
app.use('/scripts',express.static(__dirname + '/dist/scripts'));
app.use('/css',express.static(__dirname + '/dist/css'));
app.use('/client-config.js',express.static(__dirname + '/client-config.js'));
app.use('/',express.static(__dirname + '/google_verify'))
app.get('/', function (req, res) {
		console.log(req.url);
		res.sendFile(__dirname + '/' + 'dist/chooseRoom.html');
		})
app.all('/*', function (req, res) {
	   console.log(req.url);
	   res.sendFile(__dirname + '/' +'dist/index.html');
	   })
	   httpsServer.listen(config.HTTPS_PORT, '::');

// redirect to https
httpApp.all('*',function (req, res) {
res.redirect(301, "https://" + req.hostname + ":" + config.HTTPS_PORT + req.path);
console.log('HTTP request -> redirecting: ' + "https://" + req.hostname + ":" + config.HTTPS_PORT + req.path);
res.end();
}).listen(config.HTTP_PORT,'::');

httpsServer.listen(config.HTTPS_PORT, '::');

// ----------------------------------------------------------------------------------------

io.on('connection', function(socket) {
console.log(socket.request.connection.remoteAddress,socket.id);
var request_uri;
socket.ready = false;
if (socket.request.connection.remoteAddress) {
request_uri = config.REST_API_URI + '&ip=' + socket.request.connection.remoteAddress;
} else {
request_uri=config.REST_API_URI;
}
request(request_uri, function (error, response, body) {
if (!error && response.statusCode == 200) {
stunrestanswer=JSON.parse(body);
// console.log( stunrestanswer);
socket.restTURN= { urls: stunrestanswer.uris, username: stunrestanswer.username, credential: stunrestanswer.password };
console.log('sending restTURN:',socket.restTURN,socket.id);
socket.emit('restTURN',{'restTURN':socket.restTURN});
} else {
console.log("STUN/TURN REST API call: Error: "+ error );
socket.emit('restTURN',{'restTURN':null});
}

//enable statistics
if (config.ENABLESTATS){
var time = (config.TIMESTATS) ? config.TIMESTATS : 1000;
socket.emit('getStats',{'enable' : config.ENABLESTATS, 'time' : time});

//logstash connection
logstashClient = new logstashModule(config.logstash);
}

});
socket.on('ready', function(msg) {
console.log('new participant: %s in room: %s', socket.id, msg.room);
socket.join(msg.room);
socket.ready = true;
socket.room = msg.room;
socket.broadcast.to(msg.room).emit('participantReady',{'pid':socket.id, 'turn':msg.turn});
});
socket.on('sdp', function(msg) {
console.log('received sdp from %s type: %s > forward to %s ...',
socket.id, msg.sdp.type, msg.pid);
io.sockets.in(msg.pid).emit('sdp',{'sdp':msg.sdp , 'pid':socket.id, 'turn':msg.turn});
//    socket.broadcast.to(msg.pid).emit('sdp',{'sdp':msg.sdp , 'pid':socket.id});
});
socket.on('iceCandidate', function(msg) {
console.log('received iceCandidate: from %s for %s :',
socket.id, msg.pid, msg.candidate.candidate.split("typ")[1].split(" ",2 )[1]); // only log the type
socket.broadcast.to(msg.pid).emit('iceCandidate',{ 'candidate': msg.candidate, 'pid':socket.id });
});
socket.on('bye', function() {
console.log('received bye from %s forwarding to room %s', socket.id, socket.room );
socket.broadcast.to(socket.room).emit('bye',{ 'pid':socket.id } );
});
socket.on('disconnect', function() {
		console.log('client disconnected: %s in room: ', socket.id, socket.room );
		socket.broadcast.to(socket.room).emit('participantDied',{ 'pid':socket.id } );
		});
socket.on('magnetURI', function(msg) {
		console.log('client disconnected: %s in room: ', socket.id, socket.room );
		socket.broadcast.to(socket.room).emit('magnetURI',{'pid':socket.id,'magnetURI':msg} );
		});
socket.on('chat', function(msg) {
		console.log('received chat message: from %s in room: ', socket.id, socket.room );
		socket.broadcast.to(socket.room).emit('chat', {'pid':socket.id, 'chat':msg} );
		});
socket.on('name', function(msg) {
		console.log('received name: from %s in room: ', socket.id, socket.room );
		socket.broadcast.to(socket.room).emit('name', {'pid':socket.id, 'name':msg} );
		});

//GET STATS
socket.on('stats', function(msg) {
     if(msg.stat.type != "codec") {
	logstashClient.send(msg);
     }

/*    if (config.STATS.length>0){
      var result = msg.statistics;
      var local = result.connectionType.local.ipAddress[0].split(":");
      var remote = result.connectionType.remote.ipAddress[0].split(":");
      var statistics = {
        "timestamp" : msg.timestamp,
        "userName" : msg.userName,
        "room" : msg.room,
        "userPid" : msg.userPid,
        "remotePid" : msg.remotePid,
        "offerer" : result.isOfferer,
        "localIP" : local[0],
        "localPort" : local[1],
        "remoteIP" : remote[0],
        "remotePort" : remote[1],
      };
      config.STATS.forEach(function (s) {
        if (s != "rtt" && s != "videoRtt" && s != "audioRtt"){
          s = s.split('.');
          var attr = s[0];
          if (result[attr]){
            var val = result[attr];
            for (var i = 1; i <= s.length; i++){
              attr = s[i];
              if (val[attr]){
                val = val[attr];
              }
            }
            if (val){
              statistics[s.join('-')] = val;
            }
          }else{
            result.results.forEach(function(r){
              if (r[attr]){
                statistics[attr] = r[attr];
              }
            });
          }
        }else{
          result.results.forEach(function(r) {
              if (r.googRtt){
                if (r.mediaType == s.substring(0, 5)){
                  statistics[r.mediaType + "Rtt"] = r.googRtt;
                }else if(!r.mediaType && s=="rtt"){
                  statistics["rtt"] = r.googRtt;
                }
              }
          });
        }
      });
      var filename = (config.STATSFILE) ? config.STATSFILE : "statistics.json";
      fs.appendFileSync(filename, JSON.stringify(statistics)+",\r\n");
    }
*/
  });
   
});


console.log('Server running. listening on port:',config.HTTPS_PORT, config.HTTP_PORT);
