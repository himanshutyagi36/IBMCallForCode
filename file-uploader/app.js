var express = require('express');
var app = express();
var path = require('path');
var formidable = require('formidable');
var fs = require('fs');
var cfenv = require("cfenv");
var Cloudant = require("cloudant");
var port = 3001;

var vcapLocal = null;
try {
  vcapLocal = require("./vcap-local.json");
}
catch (e) {}
var appEnvOpts = vcapLocal ? {vcap:vcapLocal} : {};
var appEnv = cfenv.getAppEnv(appEnvOpts);

// Retrieves service credentials for the input service
function getServiceCreds(appEnv, serviceName) {
  var serviceCreds = appEnv.getServiceCreds(serviceName)
  if (!serviceCreds) {
    console.log("service " + serviceName + " not bound to this application");
    return null;
  }
  return serviceCreds;
}
var cloudantCreds = getServiceCreds(appEnv, "Cloudant-kt"),
  dbName = "images", 
  cloudant,
  db;


app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res){
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.post('/upload', function(req, res){
  var form = new formidable.IncomingForm();

  // specify that we want to allow the user to upload multiple files in a single request
  form.multiples = true;

  // store all uploads in the /uploads directory
  form.uploadDir = path.join(__dirname, '/uploads');

  // every time a file has been uploaded successfully,
  // rename it to it's orignal name
  form.on('file', function(field, file) {
    fs.rename(file.path, path.join(form.uploadDir, file.name));
   
    // upload to cloudant
    fs.createReadStream(path.join(form.uploadDir, file.name)).pipe(
      images.attachment.insert(file.name,file.name,null,'image/JPG')
    );
    images.list(function(err,body){
      if(!err){
        body.rows.forEach(function(doc){
          console.log("-----"+JSON.stringify(doc)+"-----");
        });
      } else {
        console.log(err);
      }
    });
    
  });

  // log any errors that occur
  form.on('error', function(err) {
    console.log('An error has occured: \n' + err);
  });

  // once all the files have been uploaded, send a response to the client
  form.on('end', function() {
    res.end('success');
  });
  
  // parse the incoming request containing the form data
  form.parse(req);

});

// api endpoint to download the results. The python application will 
// send a GET request, along with the names of the images to be downloaded.
app.get('/download',function(req,res){
  var downloadDir = path.join(__dirname, '/downloads');
  try {
    images.attachment.get('DurhumBullsGameNight.JPG','DurhumBullsGameNight.JPG').
      pipe(fs.createWriteStream(path.join(downloadDir,'DurhumBullsGameNight_result.JPG')));
    res.status('200').send('Downloaded successfully !!');
  } catch(e) {
    console.log(e.message);
    res.status('500').send('Download unsuccessfull'+e.message);
  }
  
});

function setVcapServices() {
  var cloudantCredsFromEnv = {};
	var vcap_services = JSON.parse(process.env.VCAP_SERVICES);	
	var dbCreds = vcap_services["cloudantNoSQLDB"][0];
  cloudantCredsFromEnv.username = dbCreds.credentials.username;
  cloudantCredsFromEnv.password = dbCreds.credentials.password;
  return cloudantCredsFromEnv;
}

if (process.env.VCAP_APPLICATION) {
	//overwrite defaults
	host = '0.0.0.0';
	port = process.env.PORT;
} else {
  port = 3001;
  cloudantCreds = setVcapServices();
}

var server = app.listen(port, function(){
  console.log('Server listening on port '+port);
  var dbCreated = false;
  Cloudant({account:cloudantCreds.username, password:cloudantCreds.password}, function(er, dbInstance) { 
    cloudant = dbInstance;
    if (er) {
        return console.log('Error connecting to Cloudant account %s: %s', cloudantCreds.username, er.message);
    }
    console.log('Connected to cloudant');
    cloudant.db.list(function(err, allDbs) {
      console.log('All my databases: %s', allDbs.join(', '))
    });
    images = cloudant.db.use('images');
  });
});
