// load the things we need
var mongoose = require('mongoose');
var ProgrammeSchema = require('./programme');
var channel_constants = require('./channel_constants');
// define the schema for our channel model
var ChannelSchema = mongoose.Schema({
    url: String,
    name: String,
    price: {type: Number, default: 0},
    tags: [String],
    icon: {type: String, default: channel_constants.DEFAULT_ICON_PATH},
    programmes: [ProgrammeSchema]
});

module.exports = ChannelSchema;
