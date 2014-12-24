var mongoose = require('mongoose');

var groupSchema = new mongoose.Schema({
    user_id: String,
    name: String,
    latitude: Number,
    longitude: Number,
    group_access_token: String,
    group_refresh_token: String,
});

exports.Group = mongoose.model('Group', groupSchema);