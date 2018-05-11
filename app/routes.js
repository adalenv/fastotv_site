// load up the user model
var User = require('../app/models/user');
var Channel = require('../app/models/channel');

var fs = require('fs');
var path = require('path');
var m3u8 = require('m3u8');

function stringToObj(input) {
    var elements = input.split(/([^ =]+="[^"]+")/g),
        obj = {};
    for (ind in elements) {
        if (elements[ind].length > 0) {
            var part = elements[ind];
            var ind = part.indexOf('=')
            if (ind === -1) {
                continue;
            }

            var key = part.substring(0, ind);
            var value = part.substring(ind + 1);
            obj[key] = value.replace(/^"(.*)"$/, '$1');
        }
    }

    return obj;
}

function deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(function (file, index) {
            var curPath = path + "/" + file;
            if (fs.lstatSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

function getPlaylistChannels(playlist_file, callback) {
    var tmp_path = '/tmp/' + Date.now() + '.m3u8';
    playlist_file.mv(tmp_path, function (err) {
        if (err) {
            return callback(err);
        }

        var parser = m3u8.createStream();
        var channels = [];
        parser.on('item', function (item) {
            var title = item.get('title');
            var uri = item.get('uri');
            var icon = '';

            var data = item.get('data');
            for (var i = 0; i < data.length - 1; ++i) {
                var index_data_logo = data[i].indexOf('tvg-logo');
                if (index_data_logo !== -1) {
                    title = data[data.length - 1];
                    var attr = stringToObj(data[i]);
                    if (attr.hasOwnProperty('tvg-logo')) {
                        icon = attr['tvg-logo'];
                    }
                    break;
                }
            }

            var new_channel = {url: uri, name: title, icon: icon, tags: []};
            channels.push(new_channel);
        });
        parser.on('m3u', function (m3u) {
            return callback(channels);
        });
        var file = fs.createReadStream(tmp_path);
        file.pipe(parser);
    });
}

function createRedisChannel(id, url, title, icon, programs) {  // ChannelInfo
    var epg = {id: id, url: url, display_name: title, icon: icon, programs: programs}; // EpgInfo
    return {epg: epg, video: true, audio: true}
}

module.exports = function (app, passport, nev) {
    var updateRedisUser = function (user, callback) {
        user.getChannels(function (err, channels) {
                if (err) {
                    console.error(err);
                    return callback(err);
                }

                var redis_channels = []; // Create a new empty array.
                for (i = 0; i < channels.length; i++) {
                    var channel = channels[i];
                    var programs = [];
                    for (k = 0; k < channel.programmes.length; k++) {
                        var progr = channel.programmes[k];
                        programs.push(
                            {
                                channel: progr.channel,
                                start: progr.start.getTime(),
                                stop: progr.end.getTime(),
                                title: progr.title.length > 0 ? progr.title[0] : "N/A"
                            });
                    }
                    var of_red_channel = createRedisChannel(channel._id, channel.url, channel.name, channel.icon, programs);
                    redis_channels.push(of_red_channel);
                }

                var redis_devices = [];
                for (i = 0; i < user.devices.length; i++) {
                    redis_devices.push(user.devices[i]._id);
                }

                var needed_val = {
                    id: user._id,
                    login: user.email,
                    password: user.password,
                    channels: redis_channels,
                    devices: redis_devices
                };
                var needed_val_str = JSON.stringify(needed_val);
                app.redis_connection.set(user.email, needed_val_str);
                return callback(null, user);
            }
        );
    };
    // normal routes ===============================================================
    // show the home page (will also have our login links)
    app.get('/', function (req, res) {
        res.render('index.ejs');
    });
    app.get('/supported_devices', function (req, res) {
        res.render('supported_devices.ejs');
    });
    app.get('/anonim_downloads', function (req, res) {
        res.render('anonim_downloads.ejs');
    });
    app.get('/help', function (req, res) {
        res.render('help.ejs');
    });
    app.get('/brodcasters_help', function (req, res) {
        res.render('brodcasters_help.ejs');
    });
    app.get('/channels', function (req, res) {
        var user = req.user;
        var user_official_channels = user.official_channels;
        var user_private_channels = user.private_channels;
        Channel.find({}, function (err, all_channels) {
            if (err) {
                console.error(err);
                return;
            }

            var private_pool_channels = user.private_pool_channels;
            var private_channels = [];
            for (i = 0; i < private_pool_channels.length; i++) {
                var channel = private_pool_channels[i];
                var exist = false;
                for (var j = 0; j < user_private_channels.length; j++) {
                    if (user_private_channels[j].equals(channel._id)) {
                        exist = true;
                        break;
                    }
                }
                private_channels.push(
                    {
                        id: channel._id,
                        tags: channel.tags,
                        name: channel.name,
                        url: channel.url,
                        price: channel.price,
                        icon: channel.icon,
                        checked: exist ? "checked" : ""
                    });
            }

            var official_channels = [];
            for (i = 0; i < all_channels.length; i++) {
                var channel = all_channels[i];
                var exist = false;
                for (j = 0; j < user_official_channels.length; j++) {
                    if (user_official_channels[j].equals(channel._id)) {
                        exist = true;
                        break;
                    }
                }
                official_channels.push(
                    {
                        id: channel._id,
                        tags: channel.tags,
                        name: channel.name,
                        price: channel.price,
                        icon: channel.icon,
                        checked: exist ? "checked" : ""
                    });
            }
            res.render('channels.ejs', {
                user: req.user,
                official_channels: official_channels,
                private_channels: private_channels
            });
        });
    });

    // ADD private channel
    app.post('/add_private_channel', function (req, res) {
        var user = req.user;
        var channel_name = req.body.private_channel_name;
        var channel_url = req.body.private_channel_url;
        var private_channel_tags_array = req.body.private_channel_tags.split(',');
        var tags = [];
        for (var i in private_channel_tags_array) {
            tags.push(private_channel_tags_array[i]);
        }
        var new_channel = {url: channel_url, name: channel_name, tags: tags}
        user.private_pool_channels.push(new_channel);
        user.save(function (err) {
            if (err) {
                req.flash('statusProfileMessage', err);
                return;
            }

            res.redirect('/channels');
        });
    });

    // REMOVE private channel
    app.post('/remove_private_channel', function (req, res) {
        var user = req.user;
        var channel_id = req.body.remove_channel_id;
        user.private_pool_channels.pull({_id: channel_id});
        user.save(function (err) {
            if (err) {
                req.flash('statusProfileMessage', err);
                return;
            }

            res.redirect('/channels');
        });
    });

    app.post('/add_private_playlist', function (req, res) {
        if (!req.files) {
            req.flash('statusProfileMessage', 'No files were uploaded.');
            return;
        }

        var user = req.user;
        getPlaylistChannels(req.files.playlist_file, function (channels, err) {
            if (err) {
                req.flash('statusProfileMessage', err);
                return;
            }

            for (i = 0; i < channels.length; i++) {
                var channel = channels[i];
                user.private_pool_channels.push(channel);
            }
            user.save(function (err) {
                if (err) {
                    req.flash('statusProfileMessage', err);
                    return;
                }

                res.redirect('/channels');
            });
        });
    });

    // APPLY channels
    app.post('/apply_channels', function (req, res) {
        req.files.playlist_file;

        var user = req.user;
        var official_channels_ids = JSON.parse(req.body.apply_channels_official_ids);
        var private_channels_ids = JSON.parse(req.body.apply_channels_private_ids);
        Channel.find({}, function (err, all_channels) {
            if (err) {
                console.error(err);
                return;
            }

            var official_channels = [];
            for (i = 0; i < all_channels.length; i++) {
                var of_channel = all_channels[i];
                for (j = 0; j < official_channels_ids.length; j++) {
                    if (of_channel._id == official_channels_ids[j]) {  // FIX ME find how to compare
                        official_channels.push(of_channel);
                        break;
                    }
                }
            }
            user.official_channels = official_channels;

            var private_channels = [];
            var user_private_pool_channels = user.private_pool_channels;
            for (i = 0; i < user_private_pool_channels.length; i++) {
                var channel = user_private_pool_channels[i];
                for (j = 0; j < private_channels_ids.length; j++) {
                    if (channel._id == private_channels_ids[j]) {  // FIX ME find how to compare
                        private_channels.push(channel);
                        break;
                    }
                }
            }
            user.private_channels = private_channels;

            user.save(function (err) {
                if (err) {
                    console.error(err);
                    req.flash('statusProfileMessage', err);
                    return;
                }

                updateRedisUser(user, function (err, user) {
                    if (err) {
                        console.error(err);
                        req.flash('statusProfileMessage', err);
                        return;
                    }
                    res.redirect('/profile');
                });
            });
        });
    });

    /*app.get('/user_status', function (req, res) {
        User.find({}, function (err, all_users) {
            if (err) {
                console.error(err);
                return;
            }

            var users = [];
            for (var i = 0; i < all_users.length; i++) {
                var user = all_users[i];
                if (!user.isReadOnlyMode()) {
                    users.push({id: user._id, name: user.name, created_date: user.created_date});
                }
            }
            res.render('user_status.ejs', {
                users: users
            });
        });
    });*/

    // ADD device
    app.post('/add_device', function (req, res) {
        var user = req.user;
        var device_name = req.body.device_name;
        var new_device = {"name": device_name, "created_date": Date()};
        user.devices.push(new_device);
        user.save(function (err) {
            if (err) {
                req.flash('statusProfileMessage', err);
                return;
            }

            updateRedisUser(user, function (err, user) {
                if (err) {
                    console.error(err);
                    req.flash('statusProfileMessage', err);
                    return;
                }
                res.redirect('/devices');
            });
        });
    });

    // REMOVE device
    app.post('/remove_device', function (req, res) {
        var user = req.user;
        var device_id = req.body.device_id;
        user.devices.pull({_id: device_id});
        user.save(function (err) {
            if (err) {
                req.flash('statusProfileMessage', err);
                return;
            }

            updateRedisUser(user, function (err, user) {
                if (err) {
                    console.error(err);
                    req.flash('statusProfileMessage', err);
                    return;
                }
                res.redirect('/devices');
            });
        });
    });

    app.get('/devices', function (req, res) {
        var user = req.user;
        var login = req.body.login;

        res.render('devices.ejs', {
            devices: user.devices
        });
    });

    app.get('/device_details', function (req, res) {
        var user = req.user;
        var login = user.name;

        res.render('device_details.ejs', {
            user_id: user._id,
            devices: user.devices,
            login: login
        });
    });

    app.get('/build_installer_request', function (req, res) {
        var user = req.user;

        var walk = function (dir, done) {
            console.log('scan folder: ', dir);
            var results = [];
            fs.readdir(dir, function (err, list) {
                if (err) {
                    return done(err, []);
                }
                var pending = list.length;
                if (!pending) {
                    return done(null, results);
                }
                list.forEach(function (file) {
                    var file_name = file;
                    file = path.resolve(dir, file);
                    fs.stat(file, function (err, stat) {
                        if (err) {
                            return done(err, []);
                        }

                        if (stat && stat.isDirectory()) {
                            walk(file, function (err, res) {
                                results = results.concat(res);
                                if (!--pending) {
                                    done(null, results);
                                }
                            });
                        } else {
                            var path = file.replace(app.locals.site.public_directory, '');
                            results.push({
                                'path': app.locals.site.domain + path,
                                'file_name': file_name,
                                'size': parseInt(stat.size / 1024)
                            });
                            if (!--pending) {
                                done(null, results);
                            }
                        }
                    });
                });
            });
        };

        walk(app.locals.site.users_directory + '/' + user.email, function (err, results) {
            if (err) {
                console.error(err);
            }

            res.render('build_installer_request.ejs', {
                user: user,
                builded_packages: results
            });
        });

    });

    // CLEAR user packages
    app.post('/clear_packages', function (req, res) {
        var user = req.user;
        deleteFolderRecursive(app.locals.site.users_directory + '/' + user.email);
        res.render('build_installer_request.ejs', {
            user: user,
            builded_packages: []
        });
    });

    // PROFILE SECTION =========================
    app.get('/profile', isLoggedIn, function (req, res) {
        res.render('profile.ejs', {
            user: req.user,
            message: req.flash('statusProfileMessage')
        });
    });
    // LOGOUT ==============================
    app.get('/logout', function (req, res) {
        req.logout();
        res.redirect('/');
    });

    // =============================================================================
    // AUTHENTICATE (FIRST LOGIN) ==================================================
    // =============================================================================

    // locally --------------------------------
    // LOGIN ===============================
    // show the login form
    app.get('/login', function (req, res) {
        res.render('login.ejs', {message: req.flash('loginMessage')});
    });

    // process the login form
    app.post('/login', passport.authenticate('local-login', {
        successRedirect: '/profile', // redirect to the secure profile section
        failureRedirect: '/login', // redirect back to the signup page if there is an error
        failureFlash: true // allow flash messages
    }));

    // SIGNUP =================================
    // show the signup form
    app.get('/signup', function (req, res) {
        res.render('signup.ejs', {message: req.flash('signupMessage')});
    });

    // process the signup form
    app.post('/signup', passport.authenticate('local-signup', {
        successRedirect: '/profile', // redirect to the secure profile section
        failureRedirect: '/signup', // redirect back to the signup page if there is an error
        failureFlash: true // allow flash messages
    }));

    // user accesses the link that is sent
    app.get('/email-verification/:URL', function (req, res) {
        var url = req.params.URL;
        nev.confirmTempUser(url, function (err, user) {
            var email = user.email;
            console.log("confirm message sended to: " + email + ", error: " + err);
            if (err) {
                return res.status(404).send('ERROR: sending confirmation email FAILED');
            }
            res.render('after_confirm.ejs');
        });
    });

    app.get('/after_confirm', function (req, res) {
        res.render('after_confirm.ejs');
    });

    app.post('/stream_chat', function (req, res) {
        var user = req.user;
        var channel_id = req.body.channel_id;
        Channel.find({}, function (err, all_channels) {
            if (err) {
                console.error(err);
                return;
            }

            var official_channels = [];
            for (i = 0; i < all_channels.length; i++) {
                var of_channel = all_channels[i];
                if (of_channel._id == channel_id) {  // FIX ME find how to compare
                    res.render('stream_chat.ejs', {
                        user: user,
                        channel: of_channel
                    });
                    return;
                }
            }

            res.redirect('/channels');
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
