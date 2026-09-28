UPDATE collaboration_users
   SET must_change_password = false
 WHERE must_change_password = true;
