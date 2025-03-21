const lib_date = {
  get_YYYYMMDD: function(){
    const today = new Date();
    let dd = today.getDate();

    let mm = today.getMonth()+1; 
    const yyyy = today.getFullYear();
    if(dd < 10) 
    {
      dd = '0' + dd;
    } 

    if(mm < 10) 
    {
      mm = '0' + mm;
    } 
    return [yyyy, mm, dd].join('-');
  },


  get_currentTimestamp: function(){
    return Date.now();
  }
};

//lib_date.get_YYYYMMDD = function(){ return "2019-07-16"; }