# Prompt

Create a simple, stateless web app which functionally behaves like Jackbox, Garlic Phone or any other multiplayer social games commonly played on a cellphone.
There is no database component or persistant server for the client to open web sockets with, instead at the beginning of each round players recieve a number and enter this number into a prompt displayed on their screen after visiting the main URL.
This number is referenced in a "manifest.csv" file under the "Session Number" column, which is used to retrieve other key variables from that row.
The next column "Session Image" contains a filename of an image in the `/images`, if the column 'GeoGuess' is True then the image is an equirectangular 360 panorama which will need to be loaded into a 3js viewer, if 'GeoGuess' is false then it is a regular image which will need to be viewable with an ability to pan and zoom.
Regardless of image type, there will be a button that unlocks after ten second by turning from grey to green. Once unlocked, the next page is loaded. If "GeoGuess" is true then this page emulates the functionality of the popular game "Geoguesser", where the player may drop a point on an openStreetview map, recording it's coordinates.
If "GeoGuess" is false than this page is skipped and the distance is not recorded or displayed on the final page.
Then the coordinates are compared to the contents of the "Coordinates" column using a distance calculation, and that distance is recorded as a variable.
There is a button to confirm their placement of this pointer before proceeding to the next screen, once pressed the user is presented a text input box with the prompt "OwO, what furry convention is this?", once they have entered a string that string gets recorded as a variable as they push a "enter" button. Next a screen loads with one of three multiple choice questions, A, B and C.
These are available in columns "Question A", "Question B" and "Question C", which has "A answer 1", "A answer 2" and "A answer 3" respectivly in the following columns. The correct answer is in column "Correct Answer A", "Correct Answer B" and "Correct Answer C" respectivly. Randomize the order of these buttons on screen but they should always be in a grid of four.
Record in a variable for each answer if they selected the correct answer. After answering there will be a next button to progress from A to B to C.
Once the last question has been answered, show a scoring screen. If all the answers were input sucessfully and the distance variable is less than 200 miles, show a big green checkmark.
Otherwise show a checkmark for each correctly answered question and show the distance.
Always show the name they entered in the text input box, along with the value of the "Name of Furry Convention" column.
The game is played again by reloading the application and entering another number.
