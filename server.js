var express    = require('express');
var bodyParser = require('body-parser');
var handlebars = require('express-handlebars');
var cookieParser = require('cookie-parser');
var expressSession = require('express-session');
var expressPartials = require('express-partials');
var MongoStore = require('connect-mongo')(expressSession);
var mongoose = require('mongoose');
var sassMiddleware = require('node-sass-middleware');

var app = express();

var databaseUrl = app.get('env') === 'development' ? 
        'mongodb://localhost/auxdb' : process.env.MONGO_DB_URL;
mongoose.connect(databaseUrl);

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));

var equal = function(v1, v2, options) {
    if(v1 === v2) {
      return options.fn(this);
    }
    return options.inverse(this);
};

var ifCond = function(v1, operator, v2, options) {
    var checkCondition = function(v1, operator, v2) {
        switch(operator) {
            case '==': return (v1 == v2);
            case '===': return (v1 === v2);
            case '!==': return (v1 !== v2);
            case '<': return (v1 < v2);
            case '<=': return (v1 <= v2);
            case '>': return (v1 > v2);
            case '>=': return (v1 >= v2);
            case '&&': return (v1 && v2);
            case '||': return (v1 || v2);
            default: return false;
        };
    };
    return checkCondition(v1, operator, v2) ?
        options.fn(this) : options.inverse(this);
};

app.engine(
    'handlebars',
    handlebars({
        defaultLayout: 'main',
        helpers: {
            equal: equal,
            ifCond: ifCond
        }
    })
);

app.set('view engine', 'handlebars');

app.use(expressPartials());
app.use('/public', express.static('public'));
app.use('/css', express.static(__dirname + '/css'));

app.use(cookieParser(process.env.SESSION_SECRET));
app.use(expressSession({
    store: new MongoStore({
        url: process.env.MONGO_DB_URL,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(sassMiddleware({
    src: __dirname + '/sass',
    dest: __dirname + '/public/css',
    prefix: '/public/css', // ignore /css in request for sass file
    debug: 'true',
}));


var aux = require('./routes/aux');
app.get('/create', aux.create);
app.get('/', aux.index);
app.get('/find', aux.find);
app.get('/group/:group_id', aux.show_group);
app.get('/find_nearby_groups', aux.find_nearby_groups);
app.get('/search', aux.search);
app.get('/render_voting_track', aux.render_voting_track);
app.get('/get_user_id', aux.get_user_id);

app.post('/create_group', aux.create_group);
app.post('/add_track_for_voting', aux.add_track_for_voting);
app.post('/vote', aux.vote);


app.get('/login', aux.login);
app.get('/auth', aux.auth);

var port = Number(process.env.PORT || 5000);
app.listen(port);