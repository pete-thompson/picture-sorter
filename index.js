(function () {
    // Constants
    var UNKNOWN = "unknown",
        NAME_SEPA = "-",
        FILE_INDEX_SEPA = "_",
        JPG_PICTURE_EXT = ['.JPG', '.JPEG']
        NON_JPG_PICTURE_EXT = ['.PNG', '.GIF', '.TIF', '.BMP'],
        VIDEO_EXT = ['.3G2', '.3GP', '.AVI', '.FLV', '.M4V', '.MOV', '.MP4', '.MPG', '.SWF', '.WMV'];
    // vars
    var ExifImage, fs, log, path, resultArray = [], exifFileCounter = 0, allFilesRead = false;
    // functions
    var stringStartsWith, copyOrMoveFile, pictureSorter, processFolder, processFileWithExif, processFile,
        getNewFilenameWDateWOExt, convert2Digits, findNextGoodName, backupFile, reportTally,
        generateJson, onResults, findMostRecent, isDryRun, filenameIsDate;

    fs = require('fs-extra');
    path = require('path');
    deasync = require('deasync') ;
    ExifImage = require('exif').ExifImage;
    md5File = require('md5-file');

	stringStartsWith = function (string, prefix) {
		return string.slice(0, prefix.length) == prefix;
	}

    pictureSorter = function (src, dst, opt) {
        log(opt, "Reading top folder: " + src);
		isDryRun = opt['dryrun'];
        if (fs.statSync(src)) {
            processFolder(src, dst, opt);
            if (exifFileCounter === 0) {
                onResults(resultArray, opt);
            }
            allFilesRead = true;
        } else {
            log(opt, 'Error reading source directory.');
        }
    };

    processFolder = function (src, dst, opt) {
        var currentFile, file, fileExt, fileStats, files, i, len, ref, backup;
        backup = opt['backup'];
        files = fs.readdirSync(src);
        //console.log("---results count: " + results.length);
        for (i = 0, len = files.length; i < len; i++) {
            file = files[i];
            currentFile = src + (src.endsWith(path.sep)? '' : path.sep) + file;
            fileStats = fs.statSync(currentFile);
            if (fileStats.isFile() && !stringStartsWith(file, ".")) {
                //log(opt, "processing file: " + currentFile);
                if (backup) {
                    backupFile(currentFile, file, fileStats, dst, opt);
                }
                else {
                    fileExt = path.extname(currentFile);
                    ref = fileExt.toUpperCase();
                    if (JPG_PICTURE_EXT.indexOf(ref) >= 0) {
                        exifFileCounter++;
                        processFileWithExif(currentFile, file, fileStats, fileExt, dst, opt);
                    }
                    //else if (ref && ref.length > 0 && ((ref in NON_JPG_PICTURE_EXT) || (ref in VIDEO_EXT))) {
                    else if (ref && ref.length > 0 && (NON_JPG_PICTURE_EXT.indexOf(ref) >= 0 || VIDEO_EXT.indexOf(ref) >= 0)) {
						// if the file name already contains year month date time, skip it
						if (filenameIsDate(file)) {
							log(opt, "keeping the same filename for " + currentFile);
							useModifyDate(currentFile, file, fileStats, fileExt, dst, opt, true);
						}
						else {
							useModifyDate(currentFile, file, fileStats, fileExt, dst, opt, false);
						}
                    }
                    else {
                        log(opt, "Skipped file (cause: extension): " + file);
                    }
                }
            } else if (fileStats.isDirectory()) {
                log(opt, "Reading sub-folder: " + currentFile);
                processFolder(currentFile, dst, opt);
            }
        }
    };

	filenameIsDate = function(filename) {
		return /^\d{8}[_\-]\d{6}[\.].+$/.test(filename);
	}

    onResults = function (ra, opt) {
        if (opt['report']) {
            reportTally(resultArray, opt);
        }
        if (opt['j']) {
            generateJson(resultArray, opt);
        }
    }

    processFileWithExif = function (fullSrcFileName, srcFileName, fileStats, fileExt, destFolder, opt) {
      var done = false;
      var err;
      var data;
      new ExifImage({
          image: fullSrcFileName
      }, function(asyncErr,asyncData) {
        err=asyncErr;
        data=asyncData;
        done=true;
      });
      deasync.loopWhile(function(){return !done;});

      var date, dateArr, newFileName, folder, imageDate, filepath, ref, ref1, make, model, obj;
      exifFileCounter--;
      if (!err) {
          imageDate = ((ref = data.exif) != null ? ref.DateTimeOriginal : void 0) || ((ref1 = data.image) != null ? ref1.ModifyDate : void 0);
          if (opt['report'] || opt['j']) {
              filepath = fullSrcFileName.substring(0, fullSrcFileName.length - srcFileName.length);
              ref1 = data.image;
              make = ((ref1 != null && ref1.Make != null) ? (NAME_SEPA + ref1.Make) : UNKNOWN);
              model = ((ref1 != null && ref1.Model != null) ? (NAME_SEPA + ref1.Model) : UNKNOWN);
              //log(opt, "pushing a picture: " + srcFileName + " model: " + model);
              obj = {name:srcFileName, path:filepath, ext:fileExt.toUpperCase(), make:make.trim(), model:model.trim(), size:fileStats["size"], date:imageDate};
              resultArray.push(obj);
              //console.log(resultArray);

              if (exifFileCounter === 0 && allFilesRead) {
                  onResults(resultArray, opt);
              }
              return;
          }
          if (imageDate != null) {
              date = imageDate.replace(/\ /g, ':');
              dateArr = date.split(':');
              if (dateArr.length > 5) {
                  folder = destFolder + path.sep + dateArr[0] + path.sep + dateArr[1];
                  newFileName = getNewFilenameWDateWOExt(dateArr[0], dateArr[1], dateArr[2], dateArr[3], dateArr[4], dateArr[5], fileExt, false);
                  copyOrMoveFile(fullSrcFileName, fileStats, folder, newFileName, fileExt, opt);
                  return;
              } else {
                  //log(opt, "Error parsing date info. File: " + srcFileName);
                  useModifyDate(fullSrcFileName, srcFileName, fileStats, fileExt, destFolder, opt, false);
                  return;
              }
            } else {
                //log(opt, "Error getting date from Exif info. File: " + srcFileName);
                useModifyDate(fullSrcFileName, srcFileName, fileStats, fileExt, destFolder, opt, false);
                return;
            }
        } else {
            //log(opt, "Error obtaining Exif info. File: " + err.message);
            useModifyDate(fullSrcFileName, srcFileName, fileStats, fileExt, destFolder, opt, false);
            return;
        }
    };

    copyOrMoveFile = function (fullSrcFileName, fileStats, destFolder, newFileName, fileExt, opt) {
        var move = false;
        if (opt['m'] != null) {
            move = true;
        }
		if (!isDryRun) {
			fs.mkdirsSync(destFolder);
		}

        // check if the dest file name is a valid one
        var fullDestNameWOExt = findNextGoodName(fileStats["size"], newFileName, destFolder, 0, fileExt, fullSrcFileName, null, opt);
        if (typeof fullDestNameWOExt == 'undefined') {
            var delDupes = false;
            if (opt['delDupes'] != null) { delDupes = true}
            if (delDupes) {
                log(opt, "Deleting duplicate file " + fullSrcFileName);
                if (!isDryRun) {
                  fs.unlinkSync(fullSrcFileName);
                }
            } else {
                log(opt, "File already exists, skipped file: " + fullSrcFileName);
            }
            return;
        }
        if (fullDestNameWOExt==='') {
          log(opt, "File not moved, already in the correct place " + fullSrcFileName)
        } else {
            var fullDestName = destFolder + path.sep + fullDestNameWOExt + fileExt;
            if (move) {
                log(opt, "Moving file " + fullSrcFileName + " ---> " + fullDestName);
                //fs.copySync(fullSrcFileName, fullDestName);
                //return fs.removeSync(fullSrcFileName);
    			if (!isDryRun) {
    				fs.renameSync(fullSrcFileName, fullDestName);
    			}
            } else {
                log(opt, "Copying file " + fullSrcFileName + " ---> " + fullDestName);
    			if (!isDryRun) {
    				fs.copySync(fullSrcFileName, fullDestName);
    			}
            }
        }
    };

    findNextGoodName = function(srcFileSize, fileName, destFolder, fileIndex, fileExt, fullSrcFileName, srcFileMd5, opt) {
        var justFileName = fileName + (fileIndex == 0 ? "" : (FILE_INDEX_SEPA+fileIndex));
        var fullDestName = destFolder + path.sep + justFileName + fileExt;
        var destFileStats;
        if (fullDestName == fullSrcFileName) {
          // We're attempting to move to the same place, so return blank to indicate no move
          return ""
        }
        try {
            destFileStats = fs.statSync(fullDestName);
            if (destFileStats) {
                if (destFileStats["size"] == srcFileSize) {
                    // file exists already and it's the same size - check if md5 matches
                    //log(opt, "File same size, skips file: " + fullDestName);
                    try {
                        if (srcFileMd5===null) {
                            srcFileMd5 = md5File.sync(fullSrcFileName);
                        }
                        var destFileMd5 = md5File.sync(fullDestName);
                        if (destFileMd5 === srcFileMd5) {
                            return void 0;
                        }
                    }
                    catch (ex) {
                      // Something went wrong calculating md5 - assume the files are the same to match old functionality
                      log(opt, 'exception calculating md5, assuming that files are duplicates: ' + ex.message)
                      return void 0;
                    }
                }
                fileIndex++;
                return findNextGoodName(srcFileSize, fileName, destFolder, fileIndex, fileExt, fullSrcFileName, srcFileMd5, opt);
            }
            else {
                return justFileName;
            }
        }
        catch (ex) {
            // dest file does not exists, ignore this error and continue to move or copy file
            //log(opt, "exception: " + ex.message);
            return justFileName;
        }
        return justFileName;
    }

    useModifyDate = function (fullSrcFileName, srcFileName, fileStats, fileExt, destFolder, opt, skipModDate) {
        //log(opt, "    useModifyDate: " + fullSrcFileName);
		if (opt['report'] || opt['j']) {
			filepath = fullSrcFileName.substring(0, fullSrcFileName.length - srcFileName.length);
			var obj = {name:srcFileName, path:filepath, ext:fileExt.toUpperCase(), make:UNKNOWN, model:UNKNOWN, size:fileStats["size"], date:fileStats.mtime};
			resultArray.push(obj);
			return;
		}
		var date, day, hours, minutes, seconds, month, year, fullDestFolder, newFileName;
		date = new Date(fileStats.mtime);
		year = "" + (date.getFullYear());
		month = convert2Digits(date.getMonth() + 1);
		day = convert2Digits(date.getDate());
		hours = convert2Digits(date.getHours());
		minutes = convert2Digits(date.getMinutes());
		seconds = convert2Digits(date.getSeconds());
		if (skipModDate) {
			newFileName = srcFileName.substring(0, srcFileName.length - fileExt.length);
		}
		else {
			newFileName = getNewFilenameWDateWOExt(year, month, day, hours, minutes, seconds, fileExt, false);
		}

		fullDestFolder = destFolder + path.sep + year + path.sep + month;

        copyOrMoveFile(fullSrcFileName, fileStats, fullDestFolder, newFileName, fileExt, opt);
    };

    getNewFilenameWDateWOExt = function(yr, mo, da, hr, mi, se, fileExt, prependExt) {
        return (prependExt ? (fileExt.substr(1) + NAME_SEPA) : "") + yr + NAME_SEPA + mo + NAME_SEPA + da + NAME_SEPA + hr + NAME_SEPA + mi + NAME_SEPA + se;
    }

    backupFile = function(currentFile, file, fileStats, fileExt, dst, opt) {
        var justName = file.substring(0, file.length - fileExt.length);
        // check if the dest file name exists already
        var fullDestName = findNextGoodName(fileStats["size"], justName, destFolder, 0, fileExt, fullSrcFileName, null, opt)
        if (typeof fullDestName == 'undefined') {
            log(opt, "File already exists, skipped file: " + currentFile);
            return void 0;
        }
        fullDestName = destFolder + path.sep + fullDestName + fileExt;
        log(opt, "Copying file " + currentFile + " ---> " + fullDestName);
		if (!isDryRun) {
			fs.copySync(currentFile, fullDestName);
		}
    }

    convert2Digits = function (aNum) {
        if (aNum < 10) {
            return '0' + aNum;
        }
        return "" + aNum;
    };

    /*
      tally the info
      1. video files will be categorized by its extension name
      2. pictures without EXIF info will be cataloged as UNKNOWN
      3. all others should be cataloged by it's camera model name
     */
    reportTally = function(res, opt) {
        var rec, prevRec, count, trec, modelArray = [];
        // calc total size
        count = 0;
        for (i=0; i<res.length; i++) {
            rec = res[i];
            try {
                count += parseInt(rec.size);
            }
            catch (err) {
                // ignore this rec
            }
        }

        log(opt, "-----------------------------------");
        log(opt, "Total # of files: " + res.length + ". Total size: " + Math.round(count / 1024 / 1024 * 100) / 100 + " MB");
        log(opt, "   --------------------------------");
        if (res.length > 0) {
            // first report camera models
            res.sort(function (a, b) {
                if (a.model > b.model) {
                    return 1;
                }
                if (a.model < b.model) {
                    return -1;
                }
                return 0;
            });
            prevRec = "";
            count = 0;
            for (i=0; i<res.length; i++) {
                rec = res[i];
                count++;
                //log(opt, "-- " + rec.name + ", " + rec.path + ", " + rec.make + ", " + rec.model + ", " + rec.size + ", " + rec.date);
                if (prevRec === "") {
                    prevRec = rec.model;
                }
                if (rec.model !== prevRec) {
                    // time to sort the modelArray by time and find the most recent one
                    trec = findMostRecent(modelArray);
                    log(opt, "   Camera " + prevRec + " : " + (count-1) + "  (Last one: " + (trec ? trec.date : "<error>") + ")");
                    prevRec = rec.model;
                    count = 1;
                    modelArray = [];
                    modelArray.push(rec);
                }
                else {
                    modelArray.push(rec);
                }
            }
            if (res.length > 0 && count > 0) {
                trec = findMostRecent(modelArray);
                log(opt, "   Camera " + prevRec + " : " + count + "  (Last one: " + (trec ? trec.date : "<error>") + ")");
                log(opt, "   --------------------------------");
            }
            // now report the file extension types
            res.sort(function (a, b) {
                if (a.ext > b.ext) {
                    return 1;
                }
                if (a.ext < b.ext) {
                    return -1;
                }
                return 0;
            });
            prevRec = "";
            count = 0;
            for (i=0; i<res.length; i++) {
                rec = res[i];
                count++;
                if (i === 0) {
                    prevRec = rec.ext;
                }
                if (rec.ext !== prevRec) {
                    log(opt, "   " + prevRec.substring(1) + " : " + (count-1));
                    prevRec = rec.ext;
                    count = 1;
                }
            }
            if (res.length > 0 && count > 0) {
                log(opt, "   " + prevRec.substring(1) + " : " + count);
                log(opt, "   --------------------------------");
            }
        }
        //console.log(res);
    }

    findMostRecent = function(modelArray, opt) {
        if (!modelArray) {
            return null;
        }
        if (modelArray.length < 2) {
            return modelArray[0];
        }
        modelArray.sort(function (a, b) {
            if (a.date > b.date) {
                return 1;
            }
            if (a.date < b.date) {
                return -1;
            }
            return 0;
        });
        return modelArray[modelArray.length-1];
    }

    generateJson = function (res, opt) {
        var outFile = opt['j'];
        if (outFile === undefined) {
            console.log("Error: arguments -j file must be specified.");
            return;
        }
        fs.writeFile(outFile, JSON.stringify(res), function(err) {
            if(err) {
                return console.log("Error writing to file: " + err);
            }
            console.log("The json file has been written to " + outFile);
        });
    }

    log = function (opt, msg) {
        if (opt['v'] || opt['report']) {
            return console.log(msg);
        }
    };

    module.exports = pictureSorter;

}).call(this);
