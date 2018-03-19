// require express and other modules
var express = require('express'),
    app = express(),
    http = require("http"),
    bodyParser = require('body-parser'),
    methodOverride = require('method-override'),
    cookieParser = require('cookie-parser'),
    session = require('express-session'),
    _ = require("lodash"),
    socket = require("socket.io"),
    middleware = require("./middleware"),
    passport = require('passport'),
    LocalStrategy = require('passport-local').Strategy;


var server = http.createServer(app);

/************
* DATABASE *
************/

var db = require('./models'),
  Event = db.Event,
  Rating = db.Rating,
  User = db.User;

/*************
* MIDDLEWARE *
**************/

// configure bodyParser (for receiving form data)
app.use(bodyParser.urlencoded({ extended: true, }));

// serve static files from public folder
app.use(express.static(__dirname + "/public"));

// set view engine to ejs
app.set("view engine", "ejs");

app.use(methodOverride("_method"));

/*
 * Ip Ware
*/
app.use("/events/:id", middleware.getIp );


app.use(cookieParser());
app.use(session({
  secret: 'whereismarcellino',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// passport config
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// assign signed in user to locals for template use
app.use(function(req,res,next){
  res.locals.user = req.user || null;
  next();
});


/**********
* ROUTES *
**********/



// HOMEPAGE ROUTE

app.get("/profile", middleware.isLoggedIn, function (req, res) {

  Event.find({}).populate("ratings").exec(function (err, allevents) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.render("profile", { events: allevents, user: req.user });
    }
  });

});

app.get("/events/:id", function(req, res) {


  Event.findById(req.params.id).populate("ratings").exec(function(err,event){
    if(err){
      res.status(500).json({ error: err.message });
    }
    // var ip = req.userIp.clientIp;

    if( !event ){
      res.redirect("/profile");
    }

    var userRating = req.cookies.voteId && _.find(event.ratings, function(item){
      return item._id.toString() === req.cookies.voteId;
    });

    var formUrl = "/events/"+event._id+"/rating";

    if(userRating){
      formUrl += "/"+userRating._id;
    }


    res.render("events/show", {
      event: event,
      userRating: userRating,
      formUrl: formUrl
    });

  });
});


/*
 * Rating
*/
app.post("/events/:id/rating",function(req,res){

  var id = req.params.id;

  var data = {
    score: req.body.score,
    // userAddress: req.userIp.clientIp,
    event: id
  }



  Rating.create( data, function(err,rating){
    if(err){
      res.json({ error: "error" });
    } else {

      res.cookie("voteId", rating._id );

      Event.findById(id).populate("ratings").exec(function(err, event){

        event.ratings.push(rating._id);

        event.save(function(err, saved_event){
          if(err){
            res.json({ error: "error" });
          }

          res.redirect("/events/"+id);
        });

      });
    }

  });
});

app.put("/events/:id/rating/:rating_id",function(req,res){
  console.log("Score: " + req.body.score);

  var data = { score: req.body.score };

  Rating.findByIdAndUpdate(req.params.rating_id, data )
    .exec(function(err,rating){

      if(err || !rating){
        console.log(err);
      }
      res.cookie("voteId", rating._id)

      res.redirect("/events/"+req.params.id);
    });
});

app.post("/events", function(req, res) {
  var newevent = new Event(req.body);

  if (!req.user) {
     return res.redirect("/login")
  }

  // save new event in db
  newevent.save(function (err) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      res.redirect("/profile");
    }
  });
});

// update event
app.put("/events/:id", function (req, res) {
  // get event id from url params (`req.params`)
  var eventId = req.params.id;

  if (!req.user) {
     return res.redirect("/login")
  }

  // find event in db by id
  Event.findOne({ _id: eventId, }, function (err, foundevent) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      // update the events's attributes
      foundevent.eventName = req.body.eventName || foundevent.eventName;
      foundevent.lowScore = req.body.lowScore || foundevent.lowScore;
      foundevent.highScore = req.body.highScore || foundevent.highScore;


      // save updated event in db
      foundevent.save(function (err, savedevent) {
        if (err) {
          res.status(500).json({ error: err.message, });
        } else {
          res.redirect("/profile");
        }
      });
    }
  });
});


// delete event
app.delete("/events/:id", function (req, res) {
  // get event id from url params (`req.params`)
  if (!req.user) {
     return res.redirect("/login");
  }

  var eventId = req.params.id;

  // find event in db by id and remove
  Event.findOneAndRemove({ _id: eventId, }, function () {
    res.redirect("/profile");
  });
});


// AUTH ROUTES

// show landingpage view
app.get('/', middleware.denySignedIn, function(req, res) {
  res.render('landingpage', { user: req.user, });
});

// sign up new user, then log them in
//hashes and salts password, saves new user to db
app.post('/', middleware.denySignedIn ,function(req, res) {
  User.register(new User(req.body), req.body.password, function(err, newUser) {
    if (err) {
      console.log("Error!!!" + err)
      res.status(400)
    } else {
      passport.authenticate('local')(req, res, function() {
      res.redirect('/profile');
    });
  }
  });
});

// show login view
app.get('/login', middleware.denySignedIn, function (req, res) {
 res.render('login');
});

app.post('/login',middleware.denySignedIn, passport.authenticate('local'), function(req, res) {
  console.log(req.user);
  res.redirect('/profile');
});

// log out user
app.get('/logout', function (req, res) {
  console.log("BEFORE logout", JSON.stringify(req.user));
  req.logout();
  console.log("AFTER logout", JSON.stringify(req.user));
  res.redirect('/');
});


// API ROUTES

// get all events
app.get("/api/events", function (req, res) {
  // find all events in db
  Event.find(function (err, allevents) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      res.json({ events: allevents, });
    }
  });
});

app.get("/api/users", function (req, res) {
  // find all users in db
  User.find(function (err, allusers) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      res.json({ users: allusers, });
    }
  });
});



// create new event
app.post("/api/events", function (req, res) {
  // create new event with form data (`req.body`)
  var newevent = new event(req.body);

  // save new event in db
  newevent.save(function (err, savedevent) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      res.json(savedevent);
    }
  });
});

// get one event
app.get("/api/events/:id", function (req, res) {
  // get event id from url params (`req.params`)
  var eventId = req.params.id;

  // find event in db by id
  Event.findOne({ _id: eventId, }, function (err, foundevent) {
    if (err) {
      if (err.name === "CastError") {
        res.status(404).json({ error: "Nothing found by this ID.", });
      } else {
        res.status(500).json({ error: err.message, });
      }
    } else {
      res.json(foundevent);
    }
  });
});

// update event
app.put("/api/events/:id", function (req, res) {
  // get event id from url params (`req.params`)
  var eventId = req.params.id;

  // find event in db by id
  Event.findOne({ _id: eventId, }, function (err, foundevent) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      // update the events's attributes
      foundevent.title = req.body.title;
      foundevent.description = req.body.description;

      // save updated event in db
      foundevent.save(function (err, savedevent) {
        if (err) {
          res.status(500).json({ error: err.message, });
        } else {
          res.json(savedevent);
        }
      });
    }
  });
});

// delete event
app.delete("/api/events/:id", function (req, res) {
  // get event id from url params (`req.params`)
  var eventId = req.params.id;

  // find event in db by id and remove
  Event.findOneAndRemove({ _id: eventId, }, function (err, deletedevent) {
    if (err) {
      res.status(500).json({ error: err.message, });
    } else {
      res.json(deletedPost);
    }
  });
});




/**********
 * SERVER *
 **********/

// listen on the port that Heroku prescribes (process.env.PORT) OR port 3000
server.listen(process.env.PORT || 3000, function () {
  console.log('Express server is up and running on http://localhost:3000/');
});
