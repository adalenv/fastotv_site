// load up the user model
var User = require('../app/models/user');
var Channel = require('../app/models/channel');

var fs = require('fs');
var path = require('path');

module.exports = function(app, passport) {
  // normal routes ===============================================================
  // show the home page (will also have our login links)
  app.get('/', function(req, res) {
      res.render('index.ejs');
  });
  app.get('/help', function(req, res) {
      res.render('help.ejs');
  });
  app.get('/brodcasters_help', function(req, res) {
      res.render('brodcasters_help.ejs');
  });
  app.get('/channels', function(req, res) {
    var user = req.user;
    var user_offical_channels = user.offical_channels;
    var user_private_channels = user.private_channels;
    Channel.find({}, function(err, all_channels) {
      if (err) {
        console.error(err);
        return;
      }

      var ochannels = [];
      for (var i = 0; i < all_channels.length; i++) {
        var channel = all_channels[i];
        var exist = false;
        for (var j = 0; j < user_offical_channels.length; j++) {
          if (user_offical_channels[j].equals(channel._id)) {
            exist = true;
            break;
          }
        }
        ochannels.push({id : channel._id, tags: channel.tags, name : channel.name, price : channel.price, checked :  exist ? "checked" : ""});
      }
      res.render('channels.ejs', {
        offical_channels: ochannels,
        private_channels: user_private_channels
      });
    });
  });
  
  // ADD private channel
  app.post('/add_private_channel', function(req, res) {
    var user = req.user;
    var channel_name = req.body.private_channel_name;
    var channel_url = req.body.private_channel_url;
    var private_channel_tags_array = req.body.private_channel_tags.split(',');
    var tags = [];
    for(var i in private_channel_tags_array){
      tags.push(private_channel_tags_array[i]);
    }
    var new_channel = {url : channel_url, name : channel_name, tags: tags}
    user.private_channels.push(new_channel);
    user.save(function(err) {
      if (err) {
        req.flash('statusProfileMessage', err);
        return;
      }
      
      res.redirect('/channels');
    });
  });
  
  // REMOVE private channel
  app.post('/remove_private_channel', function(req, res) {
    var user = req.user;
    var channel_id = req.body.remove_channel_id;
    user.private_channels.pull({_id: channel_id});
    user.save(function(err) {
      if (err) {
        req.flash('statusProfileMessage', err);
        return;
      }
      
      res.redirect('/channels');
    });
  });
  
  
   // APPLY channels 
  app.post('/apply_channels', function(req, res) {
    var user = req.user;
    var channels_id = JSON.parse(req.body.apply_channels_id);
    Channel.find({}, function(err, all_channels) {
      if (err) {
        console.error(err);
        return;
      }

      var redis_channels = []; // Create a new empty array.
      var channels = [];
      for (var i = 0; i < all_channels.length; i++) {
        var channel = all_channels[i];
        for (var j = 0; j < channels_id.length; j++) {
          if (channel._id == channels_id[j]) {
            channels.push(channel);
            redis_channels.push({id : channel._id, name : channel.name, url : channel.url});
            break;
          }
        }
      }
      
      user.offical_channels = channels;
      
      var user_private_channels = user.private_channels;
      for (var i = 0; i < user_private_channels.length; i++) {
        var channel = user_private_channels[i];
        redis_channels.push({id : channel._id, name : channel.name, url : channel.url});
      }
      user.save(function(err) {
        if (err) {
          req.flash('statusProfileMessage', err);
          return;
        }
        
        var needed_val = { id: user._id, login : user.local.email, password : user.local.password, channels : redis_channels};
        var needed_val_str = JSON.stringify(needed_val);
        app.redis_connection.set(user.local.email, needed_val_str);
        res.redirect('/profile');
      });
    });
  });
  app.get('/user_status', function(req, res){
    User.find({} , function(err, all_users) {
      if (err) {
        console.error(err);
        return;
      }

      var users = [];
      for (var i = 0; i < all_users.length; i++) {
        var user = all_users[i];
        if (!user.isReadOnlyMode()) {
          users.push({id: user._id, name : user.name, created_date : user.created_date});
        }
      }
      res.render('user_status.ejs', {
        users: users
      });
    }); 
  });
  app.get('/build_installer_request', function(req, res) {
      var user = req.user;
      var walk = function(dir, done) {  
        console.log('scan folder: ', dir);
        var results = [];
        fs.readdir(dir, function(err, list) {
          if (err) {
            return done(err, []);
          }
          var pending = list.length;
          if (!pending) {
            return done(null, results);
          }
          list.forEach(function(file) {
            var file_name = file;
            file = path.resolve(dir, file);
            fs.stat(file, function(err, stat) {
              if (stat && stat.isDirectory()) {
              } else {
                var path = file.replace(app.locals.site.public_directory, '');
                results.push({ 'path' : path, 'file_name' : file_name});
                if (!--pending) { 
                  done(null, results);
                }
              }
            });
          });
        });
      };
      
      walk(app.locals.site.users_directory + '/' + user.local.email, function(err, results) {
        if (err) {
          console.error(err);
        }
        
        res.render('build_installer_request.ejs', {
          user : user,
          builded_packages : results
        });
      });
      
  });
    
  // PROFILE SECTION =========================
  app.get('/profile', isLoggedIn, function(req, res) {
      res.render('profile.ejs', {
          user : req.user,
          message: req.flash('statusProfileMessage')
      });
  });
  // LOGOUT ==============================
  app.get('/logout', function(req, res) {
      req.logout();
      res.redirect('/');
  });

  // =============================================================================
  // AUTHENTICATE (FIRST LOGIN) ==================================================
  // =============================================================================

  // locally --------------------------------
  // LOGIN ===============================
  // show the login form
  app.get('/login', function(req, res) {
      res.render('login.ejs', { message: req.flash('loginMessage') });
  });

  // process the login form
  app.post('/login', passport.authenticate('local-login', {
      successRedirect : '/profile', // redirect to the secure profile section
      failureRedirect : '/login', // redirect back to the signup page if there is an error
      failureFlash : true // allow flash messages
  }));

  // SIGNUP =================================
  // show the signup form
  app.get('/signup', function(req, res) {
      res.render('signup.ejs', { message: req.flash('signupMessage') });
  });

  // process the signup form
  app.post('/signup', passport.authenticate('local-signup', {
      successRedirect : '/profile', // redirect to the secure profile section
      failureRedirect : '/signup', // redirect back to the signup page if there is an error
      failureFlash : true // allow flash messages
  }));

// facebook -------------------------------

  // send to facebook to do the authentication
  app.get('/auth/facebook', passport.authenticate('facebook', { scope : 'email' }));

  // handle the callback after facebook has authenticated the user
  app.get('/auth/facebook/callback',
      passport.authenticate('facebook', {
          successRedirect : '/profile',
          failureRedirect : '/'
      }));

    // twitter --------------------------------

  // send to twitter to do the authentication
  app.get('/auth/twitter', passport.authenticate('twitter', { scope : 'email' }));

  // handle the callback after twitter has authenticated the user
  app.get('/auth/twitter/callback',
      passport.authenticate('twitter', {
          successRedirect : '/profile',
          failureRedirect : '/'
      }));


  // google ---------------------------------
  // send to google to do the authentication
  app.get('/auth/google', passport.authenticate('google', { scope : ['profile', 'email'] }));

  // the callback after google has authenticated the user
  app.get('/auth/google/callback',
      passport.authenticate('google', {
          successRedirect : '/profile',
          failureRedirect : '/'
      }));

  // =============================================================================
  // AUTHORIZE (ALREADY LOGGED IN / CONNECTING OTHER SOCIAL ACCOUNT) =============
  // =============================================================================

  // locally --------------------------------
      app.get('/connect/local', function(req, res) {
          res.render('connect_local.ejs', { message: req.flash('loginMessage') });
      });
      app.post('/connect/local', passport.authenticate('local-signup', {
          successRedirect : '/profile', // redirect to the secure profile section
          failureRedirect : '/connect/local', // redirect back to the signup page if there is an error
          failureFlash : true // allow flash messages
      }));

  // facebook -------------------------------

  // send to facebook to do the authentication
  app.get('/connect/facebook', passport.authorize('facebook', { scope : 'email' }));

  // handle the callback after facebook has authorized the user
  app.get('/connect/facebook/callback',
      passport.authorize('facebook', {
          successRedirect : '/profile',
          failureRedirect : '/'
      }));

  // twitter --------------------------------

  // send to twitter to do the authentication
  app.get('/connect/twitter', passport.authorize('twitter', { scope : 'email' }));

  // handle the callback after twitter has authorized the user
  app.get('/connect/twitter/callback',
      passport.authorize('twitter', {
          successRedirect : '/profile',
          failureRedirect : '/'
      }));


  // google ---------------------------------

  // send to google to do the authentication
  app.get('/connect/google', passport.authorize('google', { scope : ['profile', 'email'] }));

  // the callback after google has authorized the user
  app.get('/connect/google/callback',
      passport.authorize('google', {
          successRedirect : '/profile',
          failureRedirect : '/'
      }));

  // =============================================================================
  // UNLINK ACCOUNTS =============================================================
  // =============================================================================
  // used to unlink accounts. for social accounts, just remove the token
  // for local account, remove email and password
  // user account will stay active in case they want to reconnect in the future

  // local -----------------------------------
  app.get('/unlink/local', isLoggedIn, function(req, res) {
      var user            = req.user;
      user.local.email    = undefined;
      user.local.password = undefined;
      
      user.save(function(err) {
          if (err) {
              console.error(err);
          }
          res.redirect('/profile');
      });
  });

  // facebook -------------------------------
  app.get('/unlink/facebook', isLoggedIn, function(req, res) {
      var user            = req.user;
      user.facebook.token = undefined;
      
      user.save(function(err) {
          if (err) {
              console.error(err);
          }
          res.redirect('/profile');
      });
  });

  // twitter --------------------------------
  app.get('/unlink/twitter', isLoggedIn, function(req, res) {
      var user           = req.user;
      user.twitter.token = undefined;
      
      user.save(function(err) {
          if (err) {
              console.error(err);
          }
          res.redirect('/profile');
      });
  });

  // google ---------------------------------
  app.get('/unlink/google', isLoggedIn, function(req, res) {
      var user          = req.user;
      user.google.token = undefined;
      
      user.save(function(err) {
          if (err) {
              console.error(err);
          }
          res.redirect('/profile');
      });
  });
};

// route middleware to ensure user is logged in
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect('/');
}
